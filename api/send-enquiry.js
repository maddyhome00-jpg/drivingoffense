
const RESEND_API_URL = "https://api.resend.com/emails";

const FROM_EMAIL =
    "Driving Offence Solutions <no-reply@drivingoffencesolution.co.uk>";

const OFFICE_EMAIL = "info@drivingoffencesolution.co.uk";
const WHATSAPP_NUMBER = "+44 7480 214872";

function clean(value, maxLength = 1000) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
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
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("Resend error:", response.status, result);
        throw new Error("Email provider rejected the request.");
    }

    return result;
}

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
        console.error("RESEND_API_KEY is missing.");

        return res.status(500).json({
            success: false,
            error: "Email service is not configured."
        });
    }

    try {
        const body = typeof req.body === "string"
            ? JSON.parse(req.body)
            : req.body;

        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({
                success: false,
                error: "Invalid enquiry data."
            });
        }

        // Honeypot spam protection.
        if (clean(body.website, 200)) {
            return res.status(200).json({ success: true });
        }

        const name = clean(body.name, 120);
        const email = clean(body.email, 254);
        const phone = clean(body.phone, 50);
        const preferred = clean(body.preferred, 40);
        const matter = clean(body.matter, 120);
        const authority = clean(body.authority, 120);
        const reference = clean(body.reference, 120);
        const received = clean(body.received, 30);
        const deadline = clean(body.deadline, 30);
        const hearing = clean(body.hearing, 30);
        const offence = clean(body.offence, 30);
        const position = clean(body.position, 150);
        const urgent = clean(body.urgent, 30);
        const message = clean(body.message, 5000);

        const validEmail =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

        if (
            !name ||
            !validEmail ||
            !matter ||
            message.length < 20 ||
            body.privacyConsent !== true
        ) {
            return res.status(400).json({
                success: false,
                error: "Please check the required fields and try again."
            });
        }

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

        const adminText = `
NEW WEBSITE ENQUIRY RECEIVED

You have received a new request from ${name}.

CUSTOMER DETAILS

Name: ${name}
Email: ${email}
Telephone: ${phone}
Preferred contact: ${preferred}

MATTER DETAILS

Matter type: ${matter}
Issuing authority: ${authority}
Reference number: ${reference}
Date received: ${received}
Response deadline: ${deadline}
Court hearing date: ${hearing}
Offence date: ${offence}
Current position: ${position}
Urgency: ${urgent}

CUSTOMER EXPLANATION

${message}

Reply directly to this email to contact the customer.

Driving Offence Solutions
WhatsApp: ${WHATSAPP_NUMBER}
        `;

        // ADMIN NOTIFICATION
        const officeEmail = {
            from: FROM_EMAIL,
            to: [OFFICE_EMAIL],
            reply_to: email,
            subject: `NEW ENQUIRY: ${name} — ${matter}`,
            html: emailLayout(
                "You have received a new request",
                `
                    <p style="font-size:16px">
                        You have received a new website enquiry from
                        <strong>${escapeHTML(name)}</strong>.
                    </p>

                    <p>
                        A visitor has submitted a new motoring offence
                        enquiry through the Driving Offence Solutions website.
                    </p>

                    <h3>Customer information</h3>

                    ${fields}

                    <hr style="border:0;border-top:1px solid #ddd;margin:25px 0">

                    <p style="font-size:12px;color:#666">
                        This is an automated notification. Reply directly
                        to this email to respond to the customer.
                    </p>
                `
            ),
            text: adminText
        };

        // VISITOR ACKNOWLEDGEMENT
        const visitorEmail = {
            from: FROM_EMAIL,
            to: [email],
            subject: "We have received your enquiry | Driving Offence Solutions",
            html: emailLayout(
                "Thank you for your enquiry",
                `
                    <p>Hello ${escapeHTML(name)},</p>

                    <p>
                        Thank you for contacting Driving Offence Solutions.
                        Your enquiry has been received by our office.
                    </p>

                    <p>
                        The information you submitted will be reviewed,
                        and the office will respond using the contact
                        details you provided.
                    </p>

                    <p>
                        <strong>Important:</strong> Submitting an enquiry
                        does not extend or suspend any court or legal
                        deadline. Please continue to observe the dates
                        and instructions on your documents.
                    </p>

                    <p>
                        If your matter is urgent, you can contact us
                        through WhatsApp at
                        <a href="https://wa.me/447480214872">
                            +44 7480 214872
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

Your enquiry has been received by our office. The information
you submitted will be reviewed.

Submitting an enquiry does not extend or suspend any court
or legal deadline. Please continue to observe the dates and
instructions on your documents.

WhatsApp: ${WHATSAPP_NUMBER}

Regards,
Driving Offence Solutions
            `
        };

        // Send both emails.
        const results = await Promise.all([
            sendEmail(apiKey, officeEmail),
            sendEmail(apiKey, visitorEmail)
        ]);

        console.log("Enquiry emails accepted by Resend.", {
            officeEmailId: results[0].id,
            visitorEmailId: results[1].id
        });

        return res.status(200).json({
            success: true,
            message: "Your enquiry has been received."
        });

    } catch (error) {
        console.error("Enquiry submission failed:", error);

        return res.status(500).json({
            success: false,
            error: "We could not send your enquiry. Please try again or contact the office directly."
        });
    }
};
