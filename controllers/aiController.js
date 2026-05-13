const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generateLeadNote = async (req, res) => {
  try {
    const { name, source, status, phone, email } = req.body;

    const prompt = `
Generate a professional CRM lead note:

Name: ${name}
Source: ${source}
Status: ${status}
Contact: ${phone || email}

Include:
- Summary
- Next steps
- Follow-up
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    res.json({
      note: response.choices[0].message.content,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI failed" });
  }
};

module.exports = { generateLeadNote };