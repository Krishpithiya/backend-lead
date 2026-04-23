const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name:{
    type: String,
    required: true
  },

  email: {
    type: String,
  },

  phone: {
    type: String,
  },

  source: {
    type: String,
    enum:[
      "manual",
      "website",
      "facebook",
      "linkedin",
      "referral",
      "call",
      "whatsapp",
      "other"
    ],
    default: "manual"
  },

  status: {
    type: String,
    enum: [
           "new",
      "contacted",
      "no_response",
      "interested",
      "not_interested",
      "qualified",
      "proposal_sent",
      "negotiation",
      "won",
      "lost",
      "follow_up",
      "demo_request",
      "meeting_schedule",
      "low_priority"
    ],
    default: "new"
  },

  assignedManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  notes: [
    {
      text: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],
  
  isClosed: {
    type: Boolean,
    default: false
  },

  reassignmentRequested: {
    type: Boolean,
    default: false
  },

  reassignmentReason: {
    type: String,
    default:""
  }
},{timestamps: true});

// email or phone is required

leadSchema.pre("save",async function(next){
  if(!this.email && !this.phone){
     throw new Error("Either email or phone number is required")
  }
});

module.exports = mongoose.model("Lead", leadSchema);