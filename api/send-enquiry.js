
const RESEND_API_URL = "https://api.resend.com/emails";

const FROM_EMAIL =
  "Driving Offence Solutions <no-reply@drivingoffencesolution.co.uk>";

const OFFICE_EMAIL = "info@drivingoffencesolution.co.uk";
const WHATSAPP_NUMBER = "+44 7480 214872";

const admin = require("firebase-admin");

// Firebase Admin credentials must be stored in Vercel,
// not in any public HTML or JavaScript.
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

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
  if (!value) return "";

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
    console.error("Resend error:", response.status, result);
    throw new Error(result.message || "Resend rejected the email.");
  }

  return result;
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

/* --------------------------------------------------
   ACTION 1: PUBLIC WEBSITE ENQUIRY
-------------------------------------------------- */

async function handleEnquiry(body, apiKey) {
  if (clean(body.website, 200)) {
    return {
      success: true,
      spam: true
    };
  }

  const name = clean(body.name || body.fullName, 120);
  const email = clean(body.email, 254);
  const phone = clean(body.phone, 50);

  const preferred = clean(
    body.preferred || body.preferredContact,
    40
  );

  const matter = clean(
    body.matter || body.matterType,
    120
  );

  const authority = clean(body.authority, 120);
  const reference = clean(body.reference, 120);
  const received = clean(body.received || body.dateReceived, 30);
  const deadline = clean(body.deadline || body.responseDeadline, 30);
  const hearing = clean(body.hearing || body.hearingDate, 30);
  const offence = clean(body.offence || body.offenceDate, 30);
  const position = clean(body.position || body.currentPosition, 150);
  const urgent = clean(body.urgent, 30);
  const message = clean(body.message, 5000);

  if (
    !name ||
    !validEmail(email) ||
    !matter ||
    message.length < 20 ||
    body.privacyConsent !== true
  ) {
    const error = new Error("Please check the required fields.");
    error.statusCode = 400;
    throw error;
  }

  // Save the enquiry first. This ensures the dashboard has
  // a record even if an email notification subsequently fails.
  const enquiryRef = await db.collection("enquiries").add({
    name,
    fullName: name,
    email,
    phone,
    preferredContact: preferred,
    matterType: matter,
    authority,
    reference,
    dateReceived: received,
    responseDeadline: deadline,
    hearingDate: hearing,
    offenceDate: offence,
    currentPosition: position,
    urgent,
    message,
    privacyConsent: true,
    status: "new",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const fields = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${detail("Customer name", name)}
      ${detail("Email address", email)}
      ${detail("Telephone", phone)}
      ${detail("Preferred contact", preferred)}
      ${detail("Matter type", matter)}
      ${detail("Issuing authority", authority)}
      ${detail("Reference number", reference)}
      ${detail("Date received", received)}
      ${detail("Response deadline", deadline)}
      ${detail("Court hearing date", hearing)}
      ${detail("Offence date", offence)}
      ${detail("Current position", position)}
      ${detail("Urgency", urgent)}
    </table>
    <h3 style="margin-top:28px">Customer's explanation</h3>
    <div style="background:#f5f5f3;padding:18px;white-space:pre-wrap">
      ${escapeHTML(message)}
    </div>
  `;

  const officeEmail = {
    from: FROM_EMAIL,
    to: [OFFICE_EMAIL],
    reply_to: email,
    subject: `NEW ENQUIRY: ${name} — ${matter}`,
    html: emailLayout("You have received a new request", `
      <p>You have received a new website enquiry from
      <strong>${escapeHTML(name)}</strong>.</p>
      ${fields}
      <p style="font-size:12px;color:#666">
        Enquiry reference: ${escapeHTML(enquiryRef.id)}
      </p>
    `),
    text: `
NEW WEBSITE ENQUIRY

Customer: ${name}
Email: ${email}
Telephone: ${phone}
Matter: ${matter}
Reference: ${reference}

Message:
${message}

Firestore enquiry ID: ${enquiryRef.id}
WhatsApp: ${WHATSAPP_NUMBER}
    `
  };

  const visitorEmail = {
    from: FROM_EMAIL,
    to: [email],
    subject: "We have received your enquiry | Driving Offence Solutions",
    html: emailLayout("Thank you for your enquiry", `
      <p>Hello ${escapeHTML(name)},</p>
      <p>Thank you for contacting Driving Offence Solutions.
      Your enquiry has been received by our office.</p>
      <p>Your enquiry reference is:
      <strong>${escapeHTML(enquiryRef.id)}</strong></p>
      <p>Submitting an enquiry does not extend or suspend any
      court or legal deadline. Please continue to observe the
      dates and instructions on your documents.</p>
      <p>For urgent matters, contact us on
      <a href="https://wa.me/447480214872">${WHATSAPP_NUMBER}</a>.</p>
      <p>Regards,<br>Driving Offence Solutions</p>
    `),
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

  // Email failures must not erase the enquiry already saved.
  const emailResults = await Promise.allSettled([
    sendEmail(apiKey, officeEmail),
    sendEmail(apiKey, visitorEmail)
  ]);

  const officeSent = emailResults[0].status === "fulfilled";
  const visitorSent = emailResults[1].status === "fulfilled";

  if (!officeSent) {
    console.error("Office notification failed:", emailResults[0].reason);
  }

  if (!visitorSent) {
    console.error("Customer acknowledgement failed:", emailResults[1].reason);
  }

  return {
    success: true,
    saved: true,
    enquiryId: enquiryRef.id,
    officeEmailSent: officeSent,
    visitorEmailSent: visitorSent,
    message: "Your enquiry has been saved."
  };
}

/* --------------------------------------------------
   ACTION 2: AUTHENTICATED ADMINISTRATOR EMAIL
-------------------------------------------------- */

async function handleAdminEmail(req, body, apiKey) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    const error = new Error("Administrator authentication required.");
    error.statusCode = 401;
    throw error;
  }

  const idToken = authorization.slice(7);

  // Verify the Firebase user identity.
  const decoded = await admin.auth().verifyIdToken(idToken);

  const adminSnap = await db.collection("admins").doc(decoded.uid).get();

  if (
    !adminSnap.exists ||
    adminSnap.data().role !== "admin" ||
    adminSnap.data().active !== true
  ) {
    const error = new Error("Administrator access denied.");
    error.statusCode = 403;
    throw error;
  }

  const subject = clean(body.subject, 180);
  const message = clean(body.message, 10000);
  const enquiryId = clean(body.enquiryId, 150);

  if (!subject || !message) {
    const error = new Error("Subject and message are required.");
    error.statusCode = 400;
    throw error;
  }

  let recipient = clean(body.to, 254);
  let enquiryRef = null;

  // If this is a case reply, retrieve the recipient from
  // the saved case rather than trusting a browser-supplied address.
  if (enquiryId) {
    enquiryRef = db.collection("enquiries").doc(enquiryId);

    const enquirySnap = await enquiryRef.get();

    if (!enquirySnap.exists) {
      const error = new Error("The enquiry could not be found.");
      error.statusCode = 404;
      throw error;
    }

    const enquiry = enquirySnap.data();
    const caseEmail = clean(enquiry.email, 254);

    if (!caseEmail || (recipient && recipient.toLowerCase() !== caseEmail.toLowerCase())) {
      const error = new Error("The recipient does not match the enquiry.");
      error.statusCode = 400;
      throw error;
    }

    recipient = caseEmail;
  }

  if (!validEmail(recipient)) {
    const error = new Error("A valid recipient email is required.");
    error.statusCode = 400;
    throw error;
  }

  const safeMessage = escapeHTML(message).replace(/\n/g, "<br>");

  const result = await sendEmail(apiKey, {
    from: FROM_EMAIL,
    to: [recipient],
    reply_to: OFFICE_EMAIL,
    subject,
    html: emailLayout(subject, `
      <div style="font-size:14px;line-height:1.9">
        ${safeMessage}
      </div>
      <hr style="border:0;border-top:1px solid #eee;margin:25px 0">
      <p style="font-size:13px">Kind regards,<br>
      <strong>Driving Offence Solutions</strong></p>
      <p style="font-size:12px;color:#777">
        ${OFFICE_EMAIL}<br>${WHATSAPP_NUMBER}
      </p>
    `),
    text: `${message}\n\nKind regards,\nDriving Offence Solutions\n${OFFICE_EMAIL}`
  });

  const sentAt = admin.firestore.FieldValue.serverTimestamp();

  // Record the sent email for the dashboard history.
  await db.collection("emailLogs").add({
    enquiryId: enquiryId || null,
    to: recipient,
    subject,
    resendId: result.id || null,
    sentAt,
    sentBy: decoded.uid,
    status: "accepted"
  });

  // Update the case when the message is a case reply.
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

/* --------------------------------------------------
   MAIN VERCEL HANDLER — ONE ENDPOINT
-------------------------------------------------- */

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Email service is not configured."
    });
  }

  try {
    const body = getBody(req);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request data."
      });
    }

    const action = body.action || "enquiry";

    let result;

    if (action === "admin-email") {
      result = await handleAdminEmail(req, body, apiKey);
    } else if (action === "enquiry") {
      result = await handleEnquiry(body, apiKey);
    } else {
      return res.status(400).json({
        success: false,
        error: "Unknown request action."
      });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Request failed:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "The request could not be completed."
    });
  }
};
