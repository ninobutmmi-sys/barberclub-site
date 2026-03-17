const config = require('../config/env');

/**
 * Generate an ICS calendar file content for a booking
 * @param {object} booking - Booking details
 * @param {string} booking.date - Date (YYYY-MM-DD)
 * @param {string} booking.start_time - Start time (HH:MM)
 * @param {string} booking.end_time - End time (HH:MM)
 * @param {string} booking.service_name - Service name
 * @param {string} booking.barber_name - Barber name
 * @param {string} [booking.salon_id] - Salon identifier
 * @returns {string} ICS file content
 */
function generateICS(booking) {
  const startDate = formatICSDate(booking.date, booking.start_time);
  const endDate = formatICSDate(booking.date, booking.end_time);
  const now = formatICSDateNow();
  const uid = `${booking.id}@barberclub-grenoble.fr`;
  const salon = config.getSalonConfig(booking.salon_id || 'meylan');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BarberClub//Booking//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}Z`,
    `DTSTART;TZID=Europe/Paris:${startDate}`,
    `DTEND;TZID=Europe/Paris:${endDate}`,
    `SUMMARY:${booking.service_name} - ${salon.name}`,
    `DESCRIPTION:${booking.service_name} avec ${booking.barber_name}\\n${salon.name}`,
    `LOCATION:${salon.address}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:RDV BarberClub dans 1 heure',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Format date + time to ICS format (YYYYMMDDTHHMMSS)
 * Assumes Europe/Paris timezone
 */
function formatICSDate(date, time) {
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}

function formatICSDateNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

module.exports = { generateICS };
