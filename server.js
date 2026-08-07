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


app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
