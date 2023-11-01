'use strict';
Object.defineProperty(exports, '__esModule', {value: true});
exports.handleForm = void 0;
const google_spreadsheet_1 = require('google-spreadsheet');
const axios_1 = require('axios');
// Config variables
const {
  SPREADSHEET_ID,
  SHEET_ID,
  CLI_COOKIE,
  CLIENT_EMAIL,
  RECAPTCHA_V2_SECRET,
} = process.env;
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${process.env.PRIVATE_KEY}\n-----END PRIVATE KEY-----`;
function secretCookieCheck(req) {
  return req.headers.cookie === CLI_COOKIE;
}
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'https://satoshiquest.io',
  'https://satoshiquest.blockvis.com',
  'http://satoshiquest.blockvis.com',
];
const handleForm = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.status(403).send();
    return;
  }
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-type,Accept,X-Custom-Header'
  );
  try {
    const doc = new google_spreadsheet_1.GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: CLIENT_EMAIL,
      private_key: PRIVATE_KEY,
    });
    // loads document properties and worksheets
    await doc.loadInfo();
    const sheet = doc.sheetsById[SHEET_ID];
    switch (req.method) {
      case 'OPTIONS':
        res.status(200).send();
        break;
      case 'POST':
        {
          await postForm(sheet, req.body);
          res.status(200).send();
        }
        break;
      case 'GET':
        if (secretCookieCheck(req)) {
          const payload = await getSheetData(sheet, undefined);
          res.status(200).send(payload);
        } else {
          const payload = await getSheetData(sheet, req.url.replace('/', ''));
          res.status(200).send(payload);
        }
        break;
      case 'PATCH':
        if (secretCookieCheck(req)) {
          await patchUpdatedRows(sheet, req.body);
          res.status(200).send();
        }
        break;
      default:
        res.status(400).send({status: 'Invalid method'});
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({status: e});
  }
};
exports.handleForm = handleForm;
async function postForm(sheet, data) {
  if (
    data.name === undefined ||
    data.company === undefined ||
    data.address === undefined ||
    data.what === undefined ||
    data.phone === undefined ||
    data.email === undefined ||
    data.token === undefined ||
    data.value === undefined
  ) {
    throw Error('Missing fields');
  }
  const url = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_V2_SECRET}&response=${data.token}`;
  const resp = await axios_1.default.post(url);
  if (resp.data.success == true) {
    //   if captcha is verified
    const newRow = {
      Name: data.name,
      Company: data.company,
      'Ether address': data.address,
      'What are you': data.what,
      Phone: data.phone,
      Email: data.email,
      'Added value': data.value,
    };
    await sheet.addRow(newRow);
  } else {
    throw Error(`Are you a robot?`);
  }
}
async function getSheetData(sheet, address) {
  const rows = await sheet.getRows();
  const rowsFormatted = rows
    .map((r, idx) => ({
      index: idx,
      address: r['Ether address'],
      approved: r.Approved !== undefined,
      synced: !!r['Synced'],
    }))
    .filter((r) => (address !== undefined ? r.address === address : true));
  return {rows: rowsFormatted};
}
async function patchUpdatedRows(sheet, data) {
  if (data.rows == undefined) {
    throw Error('Missing fields');
  }
  const rows = await sheet.getRows();
  const updates = data.rows.map(async (rowIndex) => {
    rows[rowIndex]['Synced'] = data.txHash;
    return rows[rowIndex].save();
  });
  Promise.all(updates);
}
