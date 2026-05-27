const https = require("https");

const normalizePhone = (phone) => String(phone || "").replace(/[^\d+]/g, "");

const postForm = (url, auth, data) =>
  new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let payload = "";
        res.on("data", (chunk) => (payload += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(payload);
          else reject(new Error(`SMS provider returned ${res.statusCode}: ${payload}`));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

const sendTextMessage = async ({ to, message }) => {
  const phone = normalizePhone(to);
  if (!phone || !message) return { sent: false, reason: "missing_phone_or_message" };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    console.log(`[SMS reminder fallback] To: ${phone} | ${message}`);
    return { sent: false, fallback: true, reason: "twilio_env_missing" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  await postForm(url, auth, { To: phone, From: from, Body: message });
  return { sent: true };
};

module.exports = { sendTextMessage };
