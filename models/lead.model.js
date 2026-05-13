const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },

  email: String,

  phone: String,

  source: {
    type: String,
    enum: [
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

  // 🔷 Notes
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

  // 🔷 Follow-up tracking
  followUps: [
    {
      date: Date,
      note: String,
      status: {
        type: String,
        enum: ["pending", "completed", "missed"],
        default: "pending"
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  // 🔷 Call logs
  callLogs: [
    {
      callType: {
        type: String,
        enum: ["incoming", "outgoing"]
      },
      duration: Number, // seconds
      note: String,
      status: {
        type: String,
        enum: ["connected", "not_connected", "busy", "no_answer"]
      },
      calledAt: {
        type: Date,
        default: Date.now
      },
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    }
  ],

  // 🔷 Meetings
  meetings: [
    {
      title: String,
      date: Date,
      location: String,
      description: String,
      status: {
        type: String,
        enum: ["scheduled", "completed", "cancelled", "no_show"],
        default: "scheduled"
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  // 🔷 File attachments
  attachments: [
    {
      fileName: String,
      fileUrl: String,
      fileType: String,
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  // 🔷 Timeline (MAIN FEATURE)
  timeline: [
    {
      type: {
        type: String,
        enum: [
          "created",
          "status_changed",
          "assigned",
          "note_added",
          "follow_up_added",
          "call_logged",
          "meeting_scheduled",
          "file_uploaded",
          "closed"
        ]
      },

      message: String,

      meta: {
        oldStatus: String,
        newStatus: String,
        followUpDate: Date,
        fileUrl: String,
        callDuration: Number
      },

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
    default: ""
  }

}, { timestamps: true });


// 🔷 Validation
leadSchema.pre("save", function () {
  if (!this.email && !this.phone) {
    throw new Error("Either email or phone number is required");
  }

  // AUTO timeline entry for new lead
  if (this.isNew) {
    this.timeline.unshift({
      type: "created",
      message: "Lead Created",
      addedBy: this.createdBy
    });
  }
});

module.exports = mongoose.model("Lead", leadSchema);




// const mongoose = require("mongoose");

// const leadSchema = new mongoose.Schema({
//   name:{
//     type: String,
//     required: true
//   },

//   email: {
//     type: String,
//   },

//   phone: {
//     type: String,
//   },

//   source: {
//     type: String,
//     enum:[
//       "manual",
//       "website",
//       "facebook",
//       "linkedin",
//       "referral",
//       "call",
//       "whatsapp",
//       "other"
//     ],
//     default: "manual"
//   },

//   status: {
//     type: String,
//     enum: [
//            "new",
//       "contacted",
//       "no_response",
//       "interested",
//       "not_interested",
//       "qualified",
//       "proposal_sent",
//       "negotiation",
//       "won",
//       "lost",
//       "follow_up",
//       "demo_request",
//       "meeting_schedule",
//       "low_priority"
//     ],
//     default: "new"
//   },

//   assignedManager: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     default: null
//   },

//   assignedAgent: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     default: null
//   },

//   createdBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     required: true
//   },

//   notes: [
//     {
//       text: String,
//       addedBy: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User"
//       },
//       createdAt: {
//         type: Date,
//         default: Date.now
//       }
//     }
//   ],
  
//   isClosed: {
//     type: Boolean,
//     default: false
//   },

//   reassignmentRequested: {
//     type: Boolean,
//     default: false
//   },

//   reassignmentReason: {
//     type: String,
//     default:""
//   }
// },{timestamps: true});

// // email or phone is required

// leadSchema.pre("save",async function(next){
//   if(!this.email && !this.phone){
//      throw new Error("Either email or phone number is required")
//   }
// });

// module.exports = mongoose.model("Lead", leadSchema);
