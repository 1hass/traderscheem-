const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// ADD YOUR DARAJA KEYS HERE LATER
const CONSUMER_KEY = 'PASTE_YOUR_KEY_HERE';
const CONSUMER_SECRET = 'PASTE_YOUR_SECRET_HERE';
const PASSKEY = 'PASTE_YOUR_PASSKEY_HERE';
const SHORTCODE = '542';
const CALLBACK_URL = 'https://traderscheem-backend.onrender.com/callback';

let accessToken = '';

async function getToken() {
  const auth = Buffer.from(CONSUMER_KEY + ':' + CONSUMER_SECRET).toString('base64');
  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + auth }
  });
  accessToken = res.data.access_token;
}

app.post('/deposit', async (req, res) => {
  let { amount, phone } = req.body;
  phone = '254' + phone.slice(-9);
  await getToken();
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
  const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');

  try {
    const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      "BusinessShortCode": SHORTCODE, "Password": password, "Timestamp": timestamp,
      "TransactionType": "CustomerPayBillOnline", "Amount": amount, "PartyA": phone,
      "PartyB": SHORTCODE, "PhoneNumber": phone, "CallBackURL": CALLBACK_URL,
      "AccountReference": "TradersCheem", "TransactionDesc": "Trading Deposit"
    }, { headers: { Authorization: 'Bearer ' + accessToken } });
    res.json({ success: true, message: "STK Push sent to " + phone });
  } catch (e) {
    res.json({ success: false, message: "Error: " + e.message });
  }
});

app.post('/callback', (req, res) => {
  const callback = req.body.Body.stkCallback;
  if(callback.ResultCode === 0) {
    const amount = callback.CallbackMetadata.Item.find(i => i.Name === 'Amount').Value;
    const phone = callback.CallbackMetadata.Item.find(i => i.Name === 'PhoneNumber').Value;
    console.log(`SUCCESS: Added KES ${amount} from ${phone}`);
  } else {
    console.log(`FAILED: ${callback.ResultDesc}`);
  }
  res.json({ ResultCode: 0, ResultDesc: "Received" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
