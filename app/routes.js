// const fetch = require('node-fetch')
require('dotenv').config()
const multer = require('multer')
const fs = require('fs')
const upload = multer({ dest: 'uploads/'})

module.exports = function(app, passport, db) {

// normal routes ===============================================================

    // show the home page (will also have our login links)
    app.get('/', function(req, res) {
        res.render('index.ejs');
    });

    // Used other projects to help figure out how to create the dashboard

    // PROFILE SECTION =========================
    app.get('/profile', isLoggedIn, function(req, res) {
        db.collection('summaries').find({userId: req.user._id}).sort({dateOfSummary: -1}).toArray((err, result) => {
          if (err) return console.log(err)
          res.render('profile.ejs', {
            user : req.user,
            summaries: result
          })
        })
    });

    app.get('/dashboard',isLoggedIn, (req, res) => {
      res.render('profile.ejs', {
        user: req.user
      })
    })

    // LOGOUT ==============================
    app.get('/logout', function(req, res) {
        req.logout(() => {
          console.log('User has logged out!')
        });
        res.redirect('/');
    });

// message board routes ===============================================================

// Got advice and help from my house on how to set up the api for my project. And also got help on how the code should look

   app.post('/summarize', isLoggedIn, upload.single('audioFile'), async (req, res) => {
    
    let audioPath = null
    
    try {
      let transcriptText = req.body.transcript?.trim() || ""

      if (req.file) {
        audioPath = req.file.path
        const audioBuffer = fs.readFileSync(audioPath)

        console.log("Audio file uploaded:", req.file.originalname)

        const transcriptResponse = await fetch(
          "https://api-inference.huggingface.co/models/openai/whisper-large-v3?wait_for_model=true",
        {
          method: "POST",
          headers: {"Authorization": `Bearer ${process.env.API_KEY}`,},
          body: audioBuffer
        }
      );

      const transcriptData = await transcriptResponse.json()

      if (transcriptData.error) {
        console.log("Whisper error:", transcriptData.error)
        return res.render("profile.ejs", {
          user: req.user,
          summaries: [],
          summary: "Whisper model is loading. Try again."
        })
      }

      transcriptText = transcriptData.text || transcriptData[0]?.text || ""
      console.log("Transcribed text:", transcriptText)
    }

    if (!transcriptText || transcriptText.length < 5) {
      return res.render('profile.ejs', {
        user: req.user,
        summaries: [],
        summary: "Please paste a transcript or upload audio file."
      })
    }

      // const { transcript } = req.body;
      // console.log('Transcript received:', transcript)

      const prompt = `Summarize the following podcast transcript. Write the summary as if you are the host speaking directly to your audience. 
      Make it conversational, friendly, and engaging:"${transcriptText}"`.trim()

      
      const response = await fetch(
        "https://router.huggingface.co/hf-inference/models/facebook/bart-large-cnn",
        {
          method: 'POST',
          headers: {Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": 'application/json'},
          body: JSON.stringify({
            inputs: prompt,
            parameters: {max_length: 250, min_length: 50, do_sample: true}
          })
        }
      )

      const data = await response.json();
      console.log('AI API response:', data)

      const summary = data[0]?.summary_text || "Could not get summary."
      console.log('Final summary:', summary)
      
      await db.collection('summaries').insertOne(
        {
          userId: req.user._id,
          summary: summary,
          dateOfSummary: new Date()
        })
        

       

          const summaries = await db.collection('summaries').find({userId: req.user._id}).sort({dateOfSummary: -1}).toArray();

          res.render('profile.ejs', {
            user: req.user,
            summaries: summaries
          })
        
      
    
    } catch (err) {
      console.log('Error getting summary from AI:', err);
      res.render('profile.ejs', {
        user: req.user,
        summaries: [],
        summary: 'Error getting summary',
      })
    
    } finally {
      if (audioPath) {
        try {
          fs.unlinkSync(audioPath)
          console.log('Audio file deleted:', audioPath)
        }catch (unlinkErr) {
          console.log('Error deleting audio file:', unlinkErr)
        }
      }
    }

   })


// =============================================================================
// AUTHENTICATE (FIRST LOGIN) ==================================================
// =============================================================================

    // locally --------------------------------
        // LOGIN ===============================
        // show the login form
        app.get('/login', function(req, res) {
            res.render('login.ejs', { message: req.flash('loginMessage') });
        });

        // process the login form
        app.post('/login', passport.authenticate('local-login', {
            successRedirect : '/profile', // redirect to the secure profile section
            failureRedirect : '/login', // redirect back to the signup page if there is an error
            failureFlash : true // allow flash messages
        }));

        // SIGNUP =================================
        // show the signup form
        app.get('/signup', function(req, res) {
            res.render('signup.ejs', { message: req.flash('signupMessage') });
        });

        // process the signup form
        app.post('/signup', passport.authenticate('local-signup', {
            successRedirect : '/profile', // redirect to the secure profile section
            failureRedirect : '/signup', // redirect back to the signup page if there is an error
            failureFlash : true // allow flash messages
        }));

// =============================================================================
// UNLINK ACCOUNTS =============================================================
// =============================================================================
// used to unlink accounts. for social accounts, just remove the token
// for local account, remove email and password
// user account will stay active in case they want to reconnect in the future

    // local -----------------------------------
    app.get('/unlink/local', isLoggedIn, function(req, res) {
        var user            = req.user;
        user.local.email    = undefined;
        user.local.password = undefined;
        user.save(function(err) {
            res.redirect('/profile');
        });
    });

};

// route middleware to ensure user is logged in
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated())
        return next();

    res.redirect('/');
}
