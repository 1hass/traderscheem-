const express = require('express'); 
const axios = require('axios'); 
const cors = require('cors'); 
const app = express(); 

app.use(express.json()); 
app.use(cors()); // This fixes CORS errors from your frontend

// TEST ROUTE
app.get('/', (req, res) => { 
  res.json({ status: "TradersCheem Backend is Running ✅" }); 
});

// ⚠️ IMPORTANT: MOVE THESE TO RENDER ENVIRONMENT VARIABLES LATER
// For now it will work. But regenerate them on Daraja after this works.
const CONSUMER_KEY = 'XTohQpkMElazZoEsG3o0erxMemccyIUIrSL6CLPNYpkDUHFQ';
const CONSUMER_SECRET = 'WPRey4bKMTQNnGsWUHBNayppWGWRxnd4iUZLG0rv5dDjGMdCC1UongXBK4UKOWzf';
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const SHORTCODE = '174379';
const CALLBACK_URL = 'https://traderscheem-backend.onrender.com/callback';

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
