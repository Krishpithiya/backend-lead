const isBeforeToday = (value) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
};

const dateError = (value, label = "Date") => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${label} is invalid`;
  if (isBeforeToday(value)) return `${label} cannot be in the past`;
  return "";
};

module.exports = { dateError, isBeforeToday };
