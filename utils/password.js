function checkPassword(value) {
  const problems = [];
  if (typeof value !== 'string' || value.length < 8) problems.push('Use at least 8 characters.');
  if (!/[A-Z]/.test(value || '')) problems.push('Add one uppercase letter.');
  if (!/[a-z!-\/:-@\[-`{-~]/.test(value || '')) problems.push('Add a lowercase letter or symbol.');
  if (!/[0-9]/.test(value || '')) problems.push('Add at least one number.');
  if ((value || '').length > 128) problems.push('Use at most 128 characters.');
  return { valid: problems.length === 0, problems };
}
module.exports = { checkPassword };
