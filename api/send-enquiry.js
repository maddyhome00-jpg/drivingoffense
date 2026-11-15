const RESEND_API_URL = "https://api.resend.com/emails";

const FROM_EMAIL =
    "Driving Offence Solutions <no-reply@drivingoffencesolution.co.uk>";

const OFFICE_EMAIL = "info@drivingoffencesolution.co.uk";
const WHATSAPP_NUMBER = "+44 7480 214872";

const admin = require("firebase-admin");

/* ==================================================
   FIREBASE ADMIN INITIALIZATION

   Firestore is retained.
   Credentials are read securely from Vercel.
================================================== */

let firebaseInitialized = false;
let db = null;

function getFirebase() {
    if (firebaseInitialized && db) {
        return { admin, db };
    }

    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!credentials || !credentials.trim()) {
        throw new Error(
            "Firebase is not configured. Add FIREBASE_SERVICE_ACCOUNT to your Vercel environment variables."
        );
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(credentials);
    } catch (error) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT is not valid JSON. Check the Vercel environment variable."
        );
    }

    if (
        !serviceAccount.project_id ||
        !serviceAccount.client_email ||
        !serviceAccount.private_key
    ) {
        throw new Error(
            "Firebase service account is incomplete. It must contain project_id, client_email and private_key."
        );
    }

    serviceAccount.private_key =
        serviceAccount.private_key.replace(/\\n/g, "\n");

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    db = admin.firestore();
    firebaseInitialized = true;

    return { admin, db };
}

/* ==================================================
   GENERAL HELPERS
================================================== */

function clean(value, maxLength = 1000) {
    if (typeof value !== "string") return "";

    return value.trim().slice(0, maxLength);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[character]));
}

function emailLayout(title, content) {
    return `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:680px;margin:auto;line-height:1.7">

            <div style="background:#111;color:#fff;padding:24px 28px">

                <div style="font-size:11px;letter-spacing:2px;color:#bbb">
                    DRIVING OFFENCE SOLUTIONS
                </div>

                <h2 style="font-weight:400;margin:10px 0 0">
                    ${escapeHTML(title)}
                </h2>

            </div>

            <div style="padding:28px;border:1px solid #ddd">
                ${content}
            </div>

            <p style="font-size:11px;color:#888;padding:10px 5px">
                Driving Offence Solutions · Leeds
            </p>

        </div>
    `;
}

function detail(label, value) {
    if (
        value === "" ||
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return `
        <tr>
            <td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;width:180px;vertical-align:top">
                ${escapeHTML(label)}
            </td>

            <td style="padding:10px;border-bottom:1px solid #eee;white-space:pre-wrap">
                ${escapeHTML(value)}
            </td>
        </tr>
    `;
}

function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getBody(req) {
    if (typeof req.body === "string") {
        return JSON.parse(req.body);
    }

    return req.body || {};
}

function makeError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

/* ==================================================
   RESEND EMAIL SENDER
================================================== */

async function sendEmail(apiKey, payload) {
    const response = await fetch(RESEND_API_URL, {
        method: "POST",

        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("Resend error:", {
            status: response.status,
            message: result.message || "Email rejected",
            name: result.name || null
        });

        throw new Error(
            result.message || "Resend rejected the email."
        );
    }

    return result;
}

/* ==================================================
   ACTION 1: PUBLIC WEBSITE ENQUIRY
================================================== */

async function handleEnquiry(body, apiKey) {

    // Spam protection
    if (clean(body.website, 200)) {
        return {
            success: true,
            spam: true
        };
    }

    const { admin, db } = getFirebase();

    // Contact details
    const name = clean(
        body.name || body.fullName,
        120
    );

    const email = clean(body.email, 254);
    const phone = clean(body.phone, 50);

    const preferred = clean(
        body.preferredContact || body.preferred,
        40
    );

    // Matter details
    const matter = clean(
        body.matterType || body.matter,
        120
    );

    const position = clean(
        body.currentPosition || body.position,
        150
    );

    const urgent = clean(body.urgent, 30);

    const message = clean(body.message, 5000);

    // Optional penalty points
    let penaltyPoints = "";

    if (
        body.penaltyPoints !== "" &&
        body.penaltyPoints !== undefined &&
        body.penaltyPoints !== null
    ) {
        const points = Number(body.penaltyPoints);

        if (
            !Number.isInteger(points) ||
            points < 0 ||
            points > 12
        ) {
            throw makeError(
                "Please enter a valid penalty points number between 0 and 12."
            );
        }

        penaltyPoints = points;
    }

    // Required fields only
    if (!name) {
        throw makeError("Your full name is required.");
    }

    if (!validEmail(email)) {
        throw makeError("Please enter a valid email address.");
    }

    if (!matter) {
        throw makeError("Please select the type of motoring matter.");
    }

    if (message.length < 20) {
        throw makeError(
            "Please provide an explanation of at least 20 characters."
        );
    }

    if (body.privacyConsent !== true) {
        throw makeError(
            "Please accept the privacy information before submitting."
        );
    }

    /* ----------------------------------------------
       SAVE ENQUIRY TO FIRESTORE FIRST
    ---------------------------------------------- */

    const enquiryData = {
        name,
        fullName: name,
        email,
        phone,

        preferredContact: preferred,

        matterType: matter,

        penaltyPoints,

        currentPosition: position,

        urgent,

        message,

        privacyConsent: true,

        status: "new",

        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const enquiryRef = await db
        .collection("enquiries")
        .add(enquiryData);

    console.log("Enquiry saved to Firestore:", enquiryRef.id);

    /* ----------------------------------------------
       BUILD ADMIN NOTIFICATION
    ---------------------------------------------- */

    const fields = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">

            ${detail("Customer name", name)}

            ${detail("Email address", email)}

            ${detail("Telephone", phone)}

            ${detail("Preferred contact", preferred)}

            ${detail("Matter type", matter)}

            ${detail(
                "Current penalty points",
                penaltyPoints === "" ? "" : String(penaltyPoints)
            )}

            ${detail("Current position", position)}

            ${detail("Urgency", urgent)}

        </table>

        <h3 style="margin-top:28px">
            Customer's explanation
        </h3>

        <div style="background:#f5f5f3;padding:18px;white-space:pre-wrap">
            ${escapeHTML(message)}
        </div>
    `;

    const officeEmail = {
        from: FROM_EMAIL,

        to: [OFFICE_EMAIL],

        reply_to: email,

        subject: `NEW ENQUIRY: ${name} — ${matter}`,

        html: emailLayout(
            "You have received a new request",
            `
                <p>
                    You have received a new website enquiry from
                    <strong>${escapeHTML(name)}</strong>.
                </p>

                ${fields}

                <p style="font-size:12px;color:#666">
                    Enquiry reference: ${escapeHTML(enquiryRef.id)}
                </p>
            `
        ),

        text: `
NEW WEBSITE ENQUIRY

Customer: ${name}
Email: ${email}
Telephone: ${phone}
Preferred contact: ${preferred}
Matter: ${matter}
Penalty points: ${penaltyPoints === "" ? "Not provided" : penaltyPoints}
Current position: ${position}
Urgency: ${urgent}

Message:
${message}

Firestore enquiry ID: ${enquiryRef.id}

WhatsApp: ${WHATSAPP_NUMBER}
        `
    };

    /* ----------------------------------------------
       BUILD CUSTOMER ACKNOWLEDGEMENT
    ---------------------------------------------- */

    const visitorEmail = {
        from: FROM_EMAIL,

        to: [email],

        subject:
            "We have received your enquiry | Driving Offence Solutions",

        html: emailLayout(
            "Thank you for your enquiry",
            `
                <p>Hello ${escapeHTML(name)},</p>

                <p>
                    Thank you for contacting Driving Offence Solutions.
                    Your enquiry has been received by our office.
                </p>

                <p>
                    Your enquiry reference is:
                    <strong>${escapeHTML(enquiryRef.id)}</strong>
                </p>

                <p>
                    Submitting an enquiry does not extend or suspend
                    any court or legal deadline. Please continue to
                    observe the dates and instructions on your documents.
                </p>

                <p>
                    For urgent matters, contact us on
                    <a href="https://wa.me/447480214872">
                        ${WHATSAPP_NUMBER}
                    </a>.
                </p>

                <p>
                    Regards,<br>
                    Driving Offence Solutions
                </p>
            `
        ),

        text: `
Hello ${name},

Thank you for contacting Driving Offence Solutions.

Your enquiry has been received.

Reference: ${enquiryRef.id}

Submitting an enquiry does not extend or suspend any
court or legal deadline.

WhatsApp: ${WHATSAPP_NUMBER}

Regards,
Driving Offence Solutions
        `
    };

    /* ----------------------------------------------
       SEND BOTH EMAILS

       Firestore record remains saved if either
       email fails.
    ---------------------------------------------- */

    const emailResults = await Promise.allSettled([

        sendEmail(apiKey, officeEmail),

        sendEmail(apiKey, visitorEmail)

    ]);

    const officeSent =
        emailResults[0].status === "fulfilled";

    const visitorSent =
        emailResults[1].status === "fulfilled";

    const officeResult = officeSent
        ? emailResults[0].value
        : null;

    const visitorResult = visitorSent
        ? emailResults[1].value
        : null;

    if (!officeSent) {
        console.error(
            "Office notification failed:",
            emailResults[0].reason
        );
    }

    if (!visitorSent) {
        console.error(
            "Customer acknowledgement failed:",
            emailResults[1].reason
        );
    }

    /* ----------------------------------------------
       RECORD EMAIL DELIVERY STATUS IN FIRESTORE
    ---------------------------------------------- */

    try {
        await enquiryRef.update({

            officeEmailSent: officeSent,

            visitorEmailSent: visitorSent,

            officeResendId: officeResult?.id || null,

            visitorResendId: visitorResult?.id || null,

            emailStatusUpdatedAt:
                admin.firestore.FieldValue.serverTimestamp()

        });
    } catch (error) {
        console.error(
            "Could not update enquiry email status:",
            error
        );
    }

    console.log("Enquiry email results:", {
        enquiryId: enquiryRef.id,
        officeEmailSent: officeSent,
        visitorEmailSent: visitorSent
    });

    return {
        success: true,

        saved: true,

        enquiryId: enquiryRef.id,

        officeEmailSent: officeSent,

        visitorEmailSent: visitorSent,

        message: "Your enquiry has been saved."
    };
}

/* ==================================================
   ACTION 2: AUTHENTICATED ADMINISTRATOR EMAIL
================================================== */

async function handleAdminEmail(req, body, apiKey) {

    const { admin, db } = getFirebase();

    const authorization =
        req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
        throw makeError(
            "Administrator authentication required.",
            401
        );
    }

    const idToken = authorization.slice(7);

    // Verify Firebase user identity
    const decoded = await admin
        .auth()
        .verifyIdToken(idToken);

    // Keep Firestore administrator verification
    const adminSnap = await db
        .collection("admins")
        .doc(decoded.uid)
        .get();

    if (
        !adminSnap.exists ||
        adminSnap.data().role !== "admin" ||
        adminSnap.data().active !== true
    ) {
        throw makeError(
            "Administrator access denied.",
            403
        );
    }

    const subject = clean(body.subject, 180);

    const message = clean(body.message, 10000);

    const enquiryId = clean(body.enquiryId, 150);

    if (!subject || !message) {
        throw makeError(
            "Subject and message are required."
        );
    }

    let recipient = clean(body.to, 254);

    let enquiryRef = null;

    /* ----------------------------------------------
       VERIFY CASE RECIPIENT
    ---------------------------------------------- */

    if (enquiryId) {

        enquiryRef = db
            .collection("enquiries")
            .doc(enquiryId);

        const enquirySnap = await enquiryRef.get();

        if (!enquirySnap.exists) {
            throw makeError(
                "The enquiry could not be found.",
                404
            );
        }

        const enquiry = enquirySnap.data();

        const caseEmail = clean(enquiry.email, 254);

        if (
            !caseEmail ||
            (
                recipient &&
                recipient.toLowerCase() !== caseEmail.toLowerCase()
            )
        ) {
            throw makeError(
                "The recipient does not match the enquiry."
            );
        }

        recipient = caseEmail;
    }

    if (!validEmail(recipient)) {
        throw makeError(
            "A valid recipient email is required."
        );
    }

    /* ----------------------------------------------
       SEND ADMIN EMAIL
    ---------------------------------------------- */

    const safeMessage = escapeHTML(message)
        .replace(/\n/g, "<br>");

    const result = await sendEmail(apiKey, {

        from: FROM_EMAIL,

        to: [recipient],

        reply_to: OFFICE_EMAIL,

        subject,

        html: emailLayout(
            subject,
            `
                <div style="font-size:14px;line-height:1.9">
                    ${safeMessage}
                </div>

                <hr style="border:0;border-top:1px solid #eee;margin:25px 0">

                <p style="font-size:13px">
                    Kind regards,<br>
                    <strong>Driving Offence Solutions</strong>
                </p>

                <p style="font-size:12px;color:#777">
                    ${OFFICE_EMAIL}<br>
                    ${WHATSAPP_NUMBER}
                </p>
            `
        ),

        text: `
${message}

Kind regards,
Driving Offence Solutions
${OFFICE_EMAIL}
        `
    });

    /* ----------------------------------------------
       RECORD EMAIL IN FIRESTORE
    ---------------------------------------------- */

    const sentAt =
        admin.firestore.FieldValue.serverTimestamp();

    await db.collection("emailLogs").add({

        enquiryId: enquiryId || null,

        to: recipient,

        subject,

        resendId: result.id || null,

        sentAt,

        createdAt: sentAt,

        sentBy: decoded.uid,

        status: "accepted"

    });

    /* ----------------------------------------------
       UPDATE CASE STATUS
    ---------------------------------------------- */

    if (enquiryRef) {

        await enquiryRef.update({

            status: "replied",

            lastRepliedAt: sentAt,

            updatedAt: sentAt,

            updatedBy: decoded.uid

        });
    }

    return {

        success: true,

        message: "Email accepted by Resend.",

        id: result.id

    };
}

/* ==================================================
   MAIN VERCEL HANDLER
================================================== */

module.exports = async function handler(req, res) {

    res.setHeader("Cache-Control", "no-store");

    /* ----------------------------------------------
       METHOD CHECK
    ---------------------------------------------- */

    if (req.method !== "POST") {

        res.setHeader("Allow", "POST");

        return res.status(405).json({

            success: false,

            error: "Method not allowed."

        });
    }

    /* ----------------------------------------------
       RESEND CONFIGURATION
    ---------------------------------------------- */

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {

        console.error("RESEND_API_KEY is missing.");

        return res.status(500).json({

            success: false,

            error: "Email service is not configured."

        });
    }

    try {

        const body = getBody(req);

        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            return res.status(400).json({

                success: false,

                error: "Invalid request data."

            });
        }

        const action = body.action || "enquiry";

        let result;

        /* ------------------------------------------
           ADMIN EMAIL ACTION
        ------------------------------------------ */

        if (action === "admin-email") {

            result = await handleAdminEmail(
                req,
                body,
                apiKey
            );

        }

        /* ------------------------------------------
           PUBLIC ENQUIRY ACTION
        ------------------------------------------ */

        else if (action === "enquiry") {

            result = await handleEnquiry(
                body,
                apiKey
            );

        }

        /* ------------------------------------------
           UNKNOWN ACTION
        ------------------------------------------ */

        else {

            return res.status(400).json({

                success: false,

                error: "Unknown request action."

            });

        }

        return res.status(200).json(result);

    } catch (error) {

        console.error("Request failed:", {
            message: error.message,
            statusCode: error.statusCode || 500
        });

        return res.status(error.statusCode || 500).json({

            success: false,

            error:
                error.message ||
                "The request could not be completed."

        });

    }

};