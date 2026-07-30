process.on('uncaughtException', err => console.error('CRASH:', err));
process.on('unhandledRejection', err => console.error('CRASH:', err));

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json());
app.use(cors()); // This fixes CORS errors from your frontend

// TEST ROUTE
app.get('/', (req, res) => {
  res.json({ status: "TradersCheem Backend is Running ✅" });
});

// ✅ NOW READING FROM RENDER ENVIRONMENT VARIABLES
const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = process.env.SHORTCODE;
const CALLBACK_URL = process.env.CALLBACK_URL;
let accessToken = '';

async function getToken() {
  try {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000
    });
    accessToken = res.data.access_token;
    return accessToken;
  } catch (error) {
    console.error("Token Error:", error.response?.data || error.message);
    throw new Error("Could not get Daraja token");
  }
}

app.post('/stkpush', async (req, res) => {
  try {
    let { amount, phone } = req.body;

    // Validation
    if (!amount || !phone) {
      return res.status(400).json({ success: false, message: "amount and phone required" });
    }

    // Format phone: 07... or +254... to 254...
    phone = phone.toString().replace(/\+/g, '');
    if (phone.startsWith('0')) phone = '254' + phone.slice(1);
    if (!phone.startsWith('254')) phone = '254' + phone;

    await getToken();

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: CALLBACK_URL,
      AccountReference: "TradersCheem",
      TransactionDesc: "Trading Deposit"
    }, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    });

    res.json({ success: true, data: response.data });

  } catch (e) {
    console.error("STK Error:", e.response?.data || e.message);
    res.status(500).json({ success: false, message: e.response?.data?.errorMessage || e.message });
  }
});
app.get('/balance/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;

    const result = await pool.query(
      'SELECT real_balance FROM users WHERE phone = $1',
      [phone]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      phone,
      balance: result.rows[0].real_balance
    });

  } catch (error) {
    console.error("Balance Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
app.post('/callback', (req, res) => {
  try {
    const callback = req.body.Body.stkCallback;
    if(callback.ResultCode === 0) {
      const items = callback.CallbackMetadata.Item;
      const amount = items.find(i => i.Name === 'Amount').Value;
      const phone = items.find(i => i.Name === 'PhoneNumber').Value;
      console.log(`SUCCESS: Added KES ${amount} from ${phone}`);
    } else {
      console.log(`FAILED: ${callback.ResultDesc}`);
    }
  } catch (e) {
    console.error("Callback Error:", e);
  }
  res.json({ ResultCode: 0, ResultDesc: "Received" });
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
