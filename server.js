const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());  // Enable CORS for frontend
app.use(express.json());

app.get('/google-calendar/events', async (req, res) => {
  try {
    const calendarId = req.query.calendarId;
    console.log(`Fetching events for calendar ID: ${calendarId}`);  // Log the request
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${req.headers.authorization}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Error fetching Google Calendar events: ${response.status}`);
      res.status(response.status).json({ error: 'Failed to fetch events' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error in backend:', error);
    res.status(500).send('Error fetching calendar events');
  }
});

app.listen(3001, () => {
    console.log("Server is running on port 3001");
  });
  

