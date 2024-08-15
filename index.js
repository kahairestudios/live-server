const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;
require("dotenv").config();
const app = express();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require("cors");

// Middleware for CORS
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "https://api.kahairstudios.com");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

app.use(cors());
app.use(express.json());

// Middleware for logging URLs
app.use((req, res, next) => {
  console.log(`URL: ${req.method} ${req.url}`);
  next();
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@kahairstudio.a9gpqc5.mongodb.net/?retryWrites=true&w=majority&appName=kahairstudio`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.sendStatus(401).send("Unauthorized");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}

const emailSender = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};
const emailClient = nodemailer.createTransport(sgTransport(emailSender));

function sendAppoinmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Appointment Confirmation for ${treatment} on ${date} at ${slot} is confirmed!`,
    text: `Dear ${patientName},\n\nYour appointment for ${treatment} on ${date} at ${slot} is confirmed!\n\nThank you for choosing Oro Dental Aid!`,
    html: `
    <div>
      <h1>Dear ${patientName},</h1>
      <p>Your appointment for ${treatment} on ${date} at ${slot} is confirmed!</p>
      <p>Thank you for choosing Oro Dental Aid!</p>

      <p>Best Regards,</p>
      <p>Oro Dental Aid</p>
    </div>
    `,
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Email sent: ", info);
    }
  });
}

function sendPaymentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `We have recived your payment for ${treatment} on ${date} at ${slot}!`,
    text: `Dear ${patientName},\n\nWe have recived your payment for ${treatment} on ${date} at ${slot}!\n\nThank you for choosing Oro Dental Aid!`,
    html: `
    <div>
      <h1>Dear ${patientName},</h1>
      <p>Thank you for your Payment. Your appointment for ${treatment} on ${date} at ${slot} is confirmed!</p>
      <h3>We have recived your payment!</h3>
      <p>Thank you for choosing Oro Dental Aid!</p>

      <p>Best Regards,</p>
      <p>Oro Dental Aid</p>
    </div>
    `,
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Email sent: ", info);
    }
  });
}

async function run() {
  try {
    const db = client.db("kahairstudio");
    const appoinmentCollection = db.collection("appoinment");
    const bookingCollection = db.collection("booking");
    const userCollection = db.collection("users");
    const paymentCollection = db.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterUser = await userCollection.findOne({ email: requester });
      if (requesterUser.role === "admin") {
        next();
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    };

    // Appointment API
    app.get("/appoinment", async (req, res) => {
      const appoinments = await appoinmentCollection
        .find()
        .project({ name: 1 })
        .toArray();
      res.send(appoinments);
    });

    app.get("/allappoinment", verifyToken, verifyAdmin, async (req, res) => {
      const appoinments = await appoinmentCollection.find().toArray();
      res.send(appoinments);
    });

    app.put("/appoinment", verifyToken, verifyAdmin, async (req, res) => {
      const appointment = req.body;
      const filter = { name: appointment.name };
      const updateDoc = {
        $set: {
          price: appointment.price,
          slots: appointment.slots,
          image: appointment.image,
        },
      };
      const result = await appoinmentCollection.updateOne(filter, updateDoc, {
        upsert: true,
      });
      res.send(result);
    });

    app.delete(
      "/appoinment/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await appoinmentCollection.deleteOne(query);
        res.send(result);
      }
    );

    // Available API

    app.get("/available", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appoinmentCollection.find(query).toArray();

      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection
        .find(bookingQuery)
        .toArray();

      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    // Booking API
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const existingBooking = await bookingCollection.findOne(query);
      if (existingBooking) {
        return res.send({
          success: false,
          booking: existingBooking,
          message: "Booking already exists!",
        });
      }

      const result = await bookingCollection.insertOne(booking);
      sendAppoinmentEmail(booking);
      return res.send({
        success: true,
        result,
      });
    });

    app.get("/booking", verifyToken, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });

    app.get("/booking/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    app.patch("/booking/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateBooking = await bookingCollection.updateOne(
        filter,
        updatedDoc
      );
      const result = await paymentCollection.insertOne(payment);
      sendPaymentEmail(payment);

      res.send(updateBooking);
    });

    // Payment API

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // User API

    app.get("/users", verifyToken, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.JWT_TOKEN_SECRET, {
        expiresIn: "1d",
      });
      res.send({ result, token });
    });

    app.put(
      "/user/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.delete("/user/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

// Default route
app.get("/", (req, res) => {
  res.send("KA Hair Studio Server is live with Railway!");
});

// Listen to port
app.listen(port, () => {
  console.log(`KA Hair Studio listening on port ${port} 🚀`);
  console.log("Connected to MongoDB Database successfully! 🚀");
});
