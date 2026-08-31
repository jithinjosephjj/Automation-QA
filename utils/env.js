require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

module.exports = {
  URL: required('SIONIQ_URL', 'https://qa.sioniq.com'),
  USER: required('SIONIQ_USER', 'admin'),
  PWD: required('SIONIQ_PWD'),
  BU: required('SIONIQ_BU', 'Cochin'),
  AUTH_FILE: 'auth/admin-cochin.json',
};
