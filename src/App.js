import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import DateTimePicker from 'react-datetime-picker';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function patchGoogleCalendarEvent(event, calendarId, session, signOut) {
  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return;
  }

  if (!event.googleEventId) {
    const googleEventId = await createGoogleCalendarEvent(event, calendarId, session, signOut);
    if (googleEventId) {
      await updateAirtableWithGoogleEventId(event.id, googleEventId);
    }
    return;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${event.googleEventId}`;
  const updatedEvent = {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + session.provider_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatedEvent)
  }).then(response => response.json())
    .then(async data => {
      if (data.error) {
        console.error('Error updating event:', data.error);
        if (data.error.status === "PERMISSION_DENIED" && data.error.message.includes('Quota exceeded')) {
          await delay(10000);
          return patchGoogleCalendarEvent(event, calendarId, session, signOut);
        }
      }
    }).catch(error => console.error('Error during fetch request:', error));
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut) {
  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return null;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const newEvent = {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  return await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.provider_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(newEvent)
  }).then(response => response.json())
    .then(data => {
      if (data.error) {
        console.error('Error creating event:', data.error);
        return null;
      } else {
        return data.id;
      }
    }).catch(error => console.error('Error during fetch request:', error));
}

async function updateAirtableWithGoogleEventId(airtableRecordId, googleEventId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = { fields: { GoogleEventId: googleEventId } };

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  }).then(response => response.json())
    .then(data => {
      if (data.error) {
        console.error('Error updating Airtable with Google Event ID:', data.error);
      }
    }).catch(error => console.error('Error during fetch request:', error));
}

async function fetchAirtableEvents() {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  const response = await fetch(url, {
    headers: {
      'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  return data.records
    .filter(record => record.fields['Calendar Event Name'] && record.fields['startDate'] && record.fields['endDate'])
    .map(record => ({
      id: record.id,
      title: record.fields['Calendar Event Name'] || "Untitled Event",
      start: new Date(record.fields['startDate']),
      end: new Date(record.fields['endDate']),
      description: record.fields['Billable Reason (If Billable)'] || '',
      branch: record.fields['b'] || 'Unknown',
      homeownerName: record.fields['Homeowner Name'] || 'Unknown',
      streetAddress: record.fields['Street Address'] || 'Unknown',
      city: record.fields['City'] || 'Unknown',
      state: record.fields['State'] || 'Unknown',
      zipCode: record.fields['Zip Code'] || 'Unknown',
      googleEventId: record.fields['GoogleEventId'] || null,
    }));
}

async function fetchFutureGoogleEvents(calendarId, session) {
  const now = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${now}`;

  let allEvents = [];
  let pageToken = '';

  do {
    const response = await fetch(`${url}&pageToken=${pageToken}`, {
      headers: { 'Authorization': 'Bearer ' + session.provider_token }
    });

    const data = await response.json();
    if (data.error) {
      console.error('Error fetching Google Calendar events:', data.error);
      return [];
    }

    const events = data.items.map(event => {
      const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date) : null;
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date) : null;

      return {
        googleEventId: event.id,
        title: event.summary || "Untitled Event",
        start: start,
        end: end,
        description: event.description || '',
        location: event.location || '',
      };
    });

    allEvents = [...allEvents, ...events];
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return allEvents;
}

async function populateAirtableWithGoogleEvents(googleEvents) {
  const now = new Date();
  for (const event of googleEvents) {
    if (event.start > now) { // Only future events
      const searchUrl = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula={Street Address}="${event.location}"`;

      const searchResponse = await fetch(searchUrl, {
        headers: {
          'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
          'Content-Type': 'application/json'
        }
      });

      const searchData = await searchResponse.json();

      const airtableRecord = {
        fields: {
          "startDate": event.start.toISOString(),
          "endDate": event.end.toISOString(),
          "GoogleEventId": event.googleEventId,
          "description": event.description,
          "Address": event.location,
        }
      };

      if (searchData.records && searchData.records.length > 0) {
        const recordId = searchData.records[0].id;

        const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${recordId}`;

        await fetch(url, {
          method: 'PATCH',
          headers: {
            'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(airtableRecord)
        }).then(response => response.json())
          .then(data => {
            console.log('Airtable record successfully updated:', data);
          }).catch(error => console.error('Error during fetch request:', error));
      } else {
        // If no matching record is found, create a new one
        const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;

        await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(airtableRecord)
        }).then(response => response.json())
          .then(data => {
            console.log('New Airtable record successfully created:', data);
          }).catch(error => console.error('Error during fetch request:', error));
      }
    }
  }
}


async function populateGoogleCalendarWithAirtableRecords(calendarInfo, session) {
  const airtableEvents = await fetchAirtableEvents();
  const now = new Date();

  for (const event of airtableEvents) {
    if (event.googleEventId) {
      console.log(`Skipping already synced event: ${event.title}`);
      continue;
    }

    if (event.start > now) { // Only future events
      const calendar = calendarInfo.find(c => c.name === event.branch);
      if (calendar) {
        const newEvent = {
          summary: event.title,
          description: event.description,
          start: { dateTime: event.start.toISOString() },
          end: { dateTime: event.end.toISOString() },
          location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
        };

        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar.id}/events`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + session.provider_token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(newEvent)
        })
          .then(response => response.json())
          .then(async data => {
            if (!data.error) {
              await updateAirtableWithGoogleEventId(event.id, data.id);
            } else {
              console.error('Error creating event:', data.error);
            }
          })
          .catch(error => console.error('Error during Google Calendar API call:', error));
      } else {
        console.log(`No calendar found for branch: ${event.branch}`);
      }
    }
  }
}

function CalendarSection({ calendarId, calendarName, session, signOut }) {
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState(new Date());
  const [eventName, setEventName] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showInputs, setShowInputs] = useState(false);

  useEffect(() => {
    if (session) {
      if (!session.provider_token) {
        signOut();
        return;
      }

      fetchFutureGoogleEvents(calendarId, session)
        .then(googleEvents => populateAirtableWithGoogleEvents(googleEvents))
        .then(() => fetchAirtableEvents())
        .then(airtableEvents => airtableEvents.forEach(event => patchGoogleCalendarEvent(event, calendarId, session, signOut)))
        .then(() => fetchFutureGoogleEvents(calendarId, session))
        .then(setEvents)
        .catch(error => console.error("Error fetching events:", error));
    }
  }, [session, signOut, calendarId]);

  function handleDateClick(date) {
    if (selectedDate && selectedDate.toDateString() === date.toDateString()) {
      setShowInputs(!showInputs);
      setSelectedDate(showInputs ? null : date);
    } else {
      const dayEvents = events.filter(event => event.start.toDateString() === date.toDateString());
      setSelectedDate(date);
      setStart(date);
      setEnd(date);
      setSelectedEvents(dayEvents || []);
      setEditingEvent(null);
      setShowInputs(true);
    }
  }

  function handleEventClick(event) {
    setEditingEvent(event);
    setStart(event.start);
    setEnd(event.end);
    setEventName(event.title);
    setEventDescription(event.description);
    setShowInputs(true);
  }

  async function saveEvent() {
    const event = {
      summary: eventName,
      description: eventDescription,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    let method = "POST";
    let url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    if (editingEvent) {
      url += `/${editingEvent.googleEventId}`;
      method = "PUT";
    }

    await fetch(url, {
      method,
      headers: {
        'Authorization': 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    })
      .then(response => response.json())
      .then(() => fetchFutureGoogleEvents(calendarId, session))
      .then(setEvents)
      .finally(resetForm);
  }

  function resetForm() {
    setEventName("");
    setEventDescription("");
    setStart(new Date());
    setEnd(new Date());
    setEditingEvent(null);
    setShowInputs(false);
  }

  function tileContent({ date, view }) {
    if (view === 'month') {
      const dayEvents = events.filter(event => event.start.toDateString() === date.toDateString());
      return dayEvents.length > 0 ? <div className="event-dot"></div> : null;
    }
  }

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
      <Calendar
        onClickDay={handleDateClick}
        value={selectedDate || new Date()}
        tileContent={tileContent}
      />
      {selectedEvents.length > 0 && (
        <div>
          <h3>Events on {selectedDate?.toDateString()}</h3>
          <ul>
            {selectedEvents.map((event, index) => (
              <li key={index} onClick={() => handleEventClick(event)}>
                <strong>{event.title}</strong><br />
                {event.description && <em>{event.description}</em>}<br />
                {event.start.toLocaleTimeString()} - {event.end.toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showInputs && (
        <>
          <p>Start of your event</p>
          <DateTimePicker onChange={setStart} value={start} />
          <p>End of your event</p>
          <DateTimePicker onChange={setEnd} value={end} />
          <p>Event name</p>
          <input type="text" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          <p>Event description</p>
          <input type="text" value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} />
          <hr />
          <button onClick={saveEvent}>
            {editingEvent ? "Update Event" : "Create Event"} in {calendarName}
          </button>
          {editingEvent && <button onClick={resetForm}>Cancel Editing</button>}
        </>
      )}
    </div>
  );
}

function App() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const calendarInfo = [
    { id: 'c_d113e252e0e5c8cfbf17a13149707a30d3c0fbeeff1baaac7a46940c2cc448ca@group.calendar.google.com', name: 'Charleston' },
    { id: 'c_03867438b82e5dfd8d4d3b6096c8eb1c715425fa012054cc95f8dea7ef41c79b@group.calendar.google.com', name: 'Greensboro' },
    { id: 'c_ad562073f4db2c47279af5aa40e53fc2641b12ad2497ccd925feb220a0f1abee@group.calendar.google.com', name: 'Myrtle Beach' },
    { id: 'c_45db4e963c3363676038697855d7aacfd1075da441f9308e44714768d4a4f8de@group.calendar.google.com', name: 'Wilmington' },
    { id: 'https://calendar.google.com/calendar/embed?src=c_0476130ac741b9c58b404c737a8068a8b1b06ba1de2a84cff08c5d15ced54edf%40group.calendar.google.com&ctz=America%2FToronto', name: 'Greenville' },
    { id: 'https://calendar.google.com/calendar/embed?src=c_df033dd6c81bb3cbb5c6fdfd58dd2931e145e061b8a04ea0c13c79963cb6d515%40group.calendar.google.com&ctz=America%2FToronto', name: 'Columbia' },
    { id: 'warranty@vanirinstalledsales.com', name: 'Raleigh' }
  ];

  const getGreeting = () => {
    const currentHour = new Date().getHours();
    if (currentHour < 12) {
      return "Good morning";
    } else if (currentHour < 18) {
      return "Good afternoon";
    } else {
      return "Good evening";
    }
  };

  useEffect(() => {
    if (session) {
      populateGoogleCalendarWithAirtableRecords(calendarInfo, session);
    }
  }, [session]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
        <h1>Warranty Calendar</h1>
        <div style={{ width: "100%", margin: "0 auto" }}>
          {session ? (
            <>
              <h2>{getGreeting()} {session.user.email}</h2>
              <hr />
              <div className="calendar-grid">
                {calendarInfo.map(calendar => (
                  <CalendarSection
                    key={calendar.id}
                    calendarId={calendar.id}
                    calendarName={calendar.name}
                    session={session}
                    signOut={() => supabase.auth.signOut()}
                  />
                ))}
              </div>
              <p></p>
              <button onClick={() => supabase.auth.signOut()}>Sign Out</button>
            </>
          ) : (
            <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { scopes: 'https://www.googleapis.com/auth/calendar' } })}>
              Sign In With Google
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
