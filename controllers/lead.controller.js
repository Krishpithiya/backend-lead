const Lead = require("../models/lead.model");

exports.createLead = async (req, res) => {
  try{
    const { name, email, phone, source } = req.body;

    const lead = new Lead({
      name, email, phone, source,
      createdBy: req.user.id
    });

    await lead.save();

    res.json({
      message: "Lead created successfully",
      lead
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};

exports.getLeads = async (req, res) => {
  try{
    let leads;

    if(req.user.role === "admin"){

      // admin can see all leads
      leads = await Lead.find();

    } else if (req.user.role === "manager"){
      
      // manager sees only assigned leads
      leads = await Lead.find({
        assignedManager: req.user.id
      });

    } else if (req.user.role === "agent"){

      // agent sees only own leads
      leads = await Lead.find({
        assignedAgent: req.user.id
      });

    }
    res.json(leads);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};

exports.getLeadById = async (req, res) => {
  try{

    const lead = await Lead.findById(req.params.id);

    if(!lead){
      return res.status(404).json({
        message: "Lead not found"
      });
    }

    res.json(lead);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};
