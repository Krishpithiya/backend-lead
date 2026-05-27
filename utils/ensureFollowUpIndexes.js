const FollowUp = require("../models/FollowUp");

const LEGACY_INDEX_NAME = "lead_1_legacyLeadFollowUpId_1";

const ensureFollowUpIndexes = async () => {
  const indexes = await FollowUp.collection.indexes();
  const legacyIndex = indexes.find((index) => index.name === LEGACY_INDEX_NAME);

  if (legacyIndex && !legacyIndex.partialFilterExpression) {
    await FollowUp.collection.dropIndex(LEGACY_INDEX_NAME);
    console.log("Replaced old follow-up legacy index");
  }

  await FollowUp.syncIndexes();
};

module.exports = ensureFollowUpIndexes;
