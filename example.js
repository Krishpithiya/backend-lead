const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(express.json());


// MongoDB atlas connection
mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));


// User schema and model
const userSchema = new mongoose.Schema({
  email: {type: String, required: true, unique: true},
  password: {type: String, required: true},
  role:{
    type: String,
    enum: ['admin', 'manager', 'agent'],
    required: true
  }
});

const User = mongoose.model("User", userSchema);


// API routes


// register api
app.post("/register", async (req, res) => {
  try{
    const {email, password, role} = req.body;
    //hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      password: hashedPassword,
      role
    });

    await user.save();

    res.json({message: "User registered successfully"});
  } catch(err){
    res.status(500).json({error: err.message});
  }
});


// login api 

app.post("/login", async (req, res) =>{
  try{
    const {email, password} = req.body;

    //check user
    const user = await User.findOne({email});
    if(!user){
      return res.status(400).json({message: "User not found"});
    }

    //check password
    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch){
      return res.status(400).json({message: "Invalid password"});
    }

    //create token

    const token = jwt.sign(
      {id: user._id, role: user.role},
      process.env.JWT_SECRET,
      {expiresIn: "1d"}
    );

    res.json({
      message: "Login successful",
      token,
      role: user.role
    });
  } catch(err){
    res.status(500).json({error: err.message});
  }

});


// start server

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});