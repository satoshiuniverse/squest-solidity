/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from 'google-spreadsheet';
import axios from 'axios';

// Config variables
const {
  SPREADSHEET_ID,
  SHEET_ID,
  CLI_COOKIE,
  CLIENT_EMAIL,
  RECAPTCHA_V2_SECRET,
} = process.env;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${process.env
  .PRIVATE_KEY!}\n-----END PRIVATE KEY-----`;

interface Form {
  name: string;
  company: string;
  address: string;
  what: string;
  phone: string;
  email: string;
  value: string;
  token: string; // Google ReCaptcha token
}

interface PatchUpdate {
  txHash: string;
  rows: Array<number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function secretCookieCheck(req: any): boolean {
  return req.headers.cookie === CLI_COOKIE;
}

const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'https://satoshiquest.io',
  'https://satoshiquest.blockvis.com',
  'http://satoshiquest.blockvis.com',
];

export const handleForm = async (req: any, res: any): Promise<void> => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!secretCookieCheck(req)) {
    res.status(403).send();
    return;
  }
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-type,Accept,X-Custom-Header'
  );
  try {
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
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
          await postForm(sheet, req.body as Form);
          res.status(200).send();
        }
        break;
      case 'GET':
        if (secretCookieCheck(req)) {
          const payload = await getSheetData(sheet, undefined);
          res.status(200).send(payload);
        } else {
          const payload = await getSheetData(
            sheet,
            (req.url as string).replace('/', '')
          );
          res.status(200).send(payload);
        }
        break;
      case 'PATCH':
        if (secretCookieCheck(req)) {
          await patchUpdatedRows(sheet, req.body as PatchUpdate);
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

async function postForm(sheet: GoogleSpreadsheetWorksheet, data: Form) {
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
  const resp = await axios.post<{success: boolean}>(url);
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

async function getSheetData(
  sheet: GoogleSpreadsheetWorksheet,
  address: undefined | string
) {
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

async function patchUpdatedRows(
  sheet: GoogleSpreadsheetWorksheet,
  data: PatchUpdate
) {
  if (data.rows == undefined) {
    throw Error('Missing fields');
  }
  const rows = await sheet.getRows();
  const updates = data.rows.map((rowIndex) => {
    rows[rowIndex]['Synced'] = data.txHash;
    return rows[rowIndex].save();
  });
  await Promise.all(updates);
}
