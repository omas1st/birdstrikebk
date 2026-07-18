const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.ADMIN_EMAIL,
    pass: process.env.ADMIN_EMAIL_PASSWORD.trim(),
  },
  tls: {
    rejectUnauthorized: false,
  },
});

exports.sendEmail = async (subject, text) => {
  try {
    await transporter.sendMail({
      from: process.env.ADMIN_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject,
      text,
    });
    console.log('Email sent:', subject);
  } catch (error) {
    console.error('Email sending failed:', error.message);
  }
};