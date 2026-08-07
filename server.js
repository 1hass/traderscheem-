process.on('uncaughtException', err => console.error('CRASH:', err));
process.on('unhandledRejection', err => console.error('CRASH:', err));

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 10000;

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
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL;

let accessToken = '';

async function getToken() {
  try {
    const response = await axios.post(
      "https://pay.pesapal.com/v3/api/Auth/RequestToken",
      {
        consumer_key: PESAPAL_CONSUMER_KEY,
        consumer_secret: PESAPAL_CONSUMER_SECRET
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    accessToken = response.data.token;
    return accessToken;

  } catch (error) {
    console.error(
      "Pesapal Token Error:",
      error.response?.data || error.message
    );
    throw new Error("Could not get Pesapal token");
  }
        }
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
// Helper: Convert USD to KES
const USD_TO_KES = 140; 

// 1. THIS ROUTE TRIGGERS THE M-PESA PROMPT
app.post('/stkpush', async (req, res) => {
    try {
        const { amount, phone } = req.body; // amount = 1 for $1, phone = 0114622873

        if (!amount || !phone) {
            return res.status(400).json({ success: false, message: "Amount and phone required" });
        }

        // Format phone to 2547...
        let formattedPhone = phone;
        if (phone.startsWith('0')) formattedPhone = '254' + phone.slice(1);
        if (phone.startsWith('+')) formattedPhone = phone.slice(1);

        const amountKES = Math.round(amount * USD_TO_KES);
        const token = await getToken();
        const orderId = "TS" + Date.now();

        console.log(`Sending STK to ${formattedPhone} for KES ${amountKES}`);

        const pesapalResponse = await axios.post(
            "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest",
            {
                id: orderId,
                currency: "KES",
                amount: amountKES,
                description: `TraderScheem Deposit $${amount}`,
                callback_url: CALLBACK_URL, // from Render env
                billing_address: {
                    phone_number: formattedPhone,
                    email_address: "noreply@traderscheem.com",
                    country_code: "KE"
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                timeout: 15000
            }
        );

        console.log("PesaPal Response:", pesapalResponse.data);

        res.json({
            success: true,
            message: `M-Pesa prompt sent to ${formattedPhone}. Enter PIN`,
            order_id: orderId
        });

    } catch (error) {
        console.error("STK Push Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.error || "Failed to send M-Pesa prompt" });
    }
});

// 2. THIS ROUTE RECEIVES PAYMENT CONFIRMATION FROM PESAPAL
app.post('/callback', async (req, res) => {
    try {
        console.log("CALLBACK RECEIVED:", req.body);
        
        const { OrderTrackingId, PaymentStatus, Amount, PhoneNumber } = req.body;

        if (PaymentStatus === "COMPLETED") {
            // 1. Convert KES back to USD
            const amountUSD = Amount / USD_TO_KES;
            // 2. Update user balance in DB
            await pool.query(
                'UPDATE users SET real_balance = real_balance + $1 WHERE phone = $2',
                [amountUSD, PhoneNumber]
            );
            console.log(`Credited $${amountUSD} to ${PhoneNumber}`);
        }

        res.status(200).send("OK"); // Must reply OK to PesaPal
    } catch (error) {
        console.error("Callback Error:", error);
        res.status(500).send("Error");
    }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
