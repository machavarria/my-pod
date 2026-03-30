// const fetch = require('node-fetch')
require('dotenv').config()
const multer = require('multer')
const { ObjectID } = require("mongodb")
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const upload = multer({ dest: 'uploads/'})
const { GoogleGenAI } = require("@google/genai")
const axios = require("axios")
const geminiAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

async function extractKeywords (summary) {
  try {
    const prompt = `
    Extract 5-6 short, relevant keywords from this podcast summary. Only return a comma-seperated list. No sentences.
    
    Summary: "${summary}"
    `;

    const response = await geminiAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{text: prompt}]
        }
      ]
    });

    const text =
      response?.response?.text?.()?.trim() ||
      response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return text.split(",").map(k => k.trim()).filter(Boolean);

  } catch  (err) {
    console.log("Keywords extraction error:", err);
    return [];
  }
}

async function transcribeAudioGoogle(filePath) {
  console.log("Using Gemini to transcribe")

  const wavPath = filePath + ".wav";

  await new Promise((done, fail) => {
    ffmpeg(filePath)
      .outputOptions(['-ac 1', '-ar 16000'])
      .toFormat('wav')
      .save(wavPath)
      .on('end', done)
      .on('error', fail);
  });

  const audioContent = fs.readFileSync(wavPath).toString("base64");

  try {
    const geminiResponse = await geminiAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: audioContent
              }
            },
            { text: "Transcribe this audio file accurately."}
          ]
        }
      ]
    })

    fs.unlinkSync(wavPath);

    const transcript = geminiResponse?.response?.text?.()?.trim() ||
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";


    return transcript;

  } catch (err) {
    console.log("Error transcribing audio:", err);
    return "";
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(filePath); } catch {}
  }
}

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
            summaries: result,
            latestSummary: null,
            latestHashtags: []
          })
        })
    });

    app.get('/dashboard',isLoggedIn, (req, res) => {
      res.render('profile.ejs', {
        user: req.user
      })
    })

    // LOGOUT ==============================
    app.get('/logout', async function(req, res) {
        await req.logout()
        console.log('User has logged out!')
        res.redirect('/');
    });

// message board routes ===============================================================

// Got advice and help from my house on how to set up the api for my project. And also got help on how the code should look

    app.post('/summarize', isLoggedIn, upload.single('audioFile'), async (req, res) => {
      let audioPath = null;
      let transcriptText = (req.body.transcript || "").trim();

      console.log("Recevied file:", req.file);

      try {
        if (req.file) {
          audioPath = req.file.path;
          transcriptText = await transcribeAudioGoogle(audioPath);
          console.log("Transcribed text:", transcriptText);
        }

        if (!transcriptText || transcriptText.length < 5) {
          return res.render('profile.ejs', {
            user: req.user,
            summaries: [],
            latestSummary: "Please paste a transcript or upload audio file.",
            latestHashtags: []
          });
        }

        const prompt = `Summarize the following podcast transcript as if you are the host speaking directly to your audience and start off with something different.
        Make it conversational, friendly, and engaging. Then generate 5-7 SEO-friendly hashtags.
        Return it like: "..." and then "tag1", "tag2", ...
        
        Podcast transcript: "${transcriptText}"`;

        const geminiResponse = await geminiAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: prompt}]
            }
          ]
        });

        const responseText = geminiResponse?.response?.text?.()?.trim() ||
          geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        console.log("Gemini response:", responseText);

        let result = { summary: "", hashtags: [] };

        try {
          result = JSON.parse(responseText);
        }
        catch {
          result.summary = responseText;
          result.hashtags = [];
        }

        const summary = result.summary || "Could not get summary.";
        const hashtags = (result.hashtags || [])
          .map(tag => "#" + tag.replace(/\s+/g, ""))
          .slice(0, 7);

          console.log("Summary:", summary);
          console.log("Hashtags:", hashtags);


          await db.collection('summaries').insertOne({
            userId: req.user._id,
            summary: summary,
            hashtags: hashtags,
            rating: 0,
            dateOfSummary: new Date()
          });

          const summaries = await db.collection('summaries')
            .find({ userId: req.user._id })
            .sort({ dateOfSummary: -1 })
            .toArray();

          res.render('profile.ejs', {
            user: req.user,
            summaries: summaries,
            latestSummary: summary,
            latestHashtags: hashtags
          });

      } catch (err) {
        console.log('Error processing summary:', err);
        res.render('profile.ejs', {
          user: req.user,
          summaries: [],
          latestSummary: 'Error getting summary',
          latestHashtags: []
        });

      } finally {
        if (audioPath) {
          try {
            fs.unlinkSync(audioPath);
            console.log('Audio file deleted:', audioPath);
          } catch {}
        }
      }
    })

    app.post("/recommended-podcasts", isLoggedIn, async (req, res) => {
      try {
        const { summary } = req.body;

        if (!summary || summary.length < 5) {
          return res.json({ success: false, message: "No summary provided." });
        }

        let keywords = await extractKeywords(summary);

        keywords = keywords.filter(k => k.length > 2 && !["podcast", "episode", "discussion", "talk"].includes(k.toLowerCase()));

        if (keywords.length === 0) {
          return res.json({success: false, message: "No usable keywords found."});
        }

        const query = keywords.join(" ");

        const response = await axios.get("https://listen-api.listennotes.com/api/v2/search", {
          params: {
            q: query,
            type: "episode",
            sort_by_date: 0,
            offset: 0,
            page_size: 3
          },
          headers: {
            "X-ListenAPI-Key": process.env.LISTEN_NOTES_API_KEY
          }
        });

        res.json({
          success: true,
          results: response.data.results
        });
      } catch (err) {
        console.log("Recommendation Error", err);
        res.json({ success: false, message: "Error fetching recommendations." })
      }
    });

    app.post("/rate-summary", isLoggedIn, async (req, res) => {
      try {
        await db.collection("summaries").updateOne(
          { _id: new ObjectID(req.body.summaryID), userId: req.user._id },
          { $set: { rating: Number(req.body.rating) } }
        )
        res.json({ success: true })
      } catch (error) {
        console.log("Rating error:", error)
        res.json({ success: false })
      }
    })


    app.delete("/delete-summary", isLoggedIn, async (req, res) => {
      try {
      const summaryID = req.body.summaryID;

      if (!summaryID) {
        return res.status(400).json({ success: false, message: "No summary ID provided" });
      }

        await db.collection("summaries").deleteOne({
          _id: new ObjectID(summaryID),
          userId: req.user._id
        })
        res.json({ success: true })
      } catch (err) {
        console.log("Delete error:", err)
        res.json({ success: false, message: "Server error"})
      }
    })


  //  app.post('/summarize', isLoggedIn, upload.single('audioFile'), async (req, res) => {
    
  //   let audioPath = null
  //   let transcriptText = (req.body.transcript || "").trim()
    
  //   try {  

  //     if (req.file) { //Transcribe audio (if uploaded)
  //       audioPath = req.file.path
  //       transcriptText = await transcribeAudioGoogle(audioPath)

  //       console.log("Transcribed text:", transcriptText)

  //       const transcriptResponse = await fetch(
  //         "https://api-inference.huggingface.co/models/openai/whisper-large-v3?wait_for_model=true",
  //         {
  //         method: "POST",
  //         headers: {"Authorization": `Bearer ${process.env.API_KEY}`,},
  //         body: audioBuffer
  //         }
  //       )

  //     const transcriptData = await transcriptResponse.json()

  //     if (transcriptData.error) {
  //       console.log("Whisper error:", transcriptData.error)
  //       return res.render("profile.ejs", {
  //         user: req.user,
  //         summaries: [],
  //         summary: "Whisper model is loading. Try again."
  //       })
  //     }

  //     transcriptText = transcriptData.text || transcriptData[0]?.text || ""
  //     console.log("Transcribed text:", transcriptText)
  //     }

  //   if (!transcriptText || transcriptText.length < 5) { // Safety Check
  //     return res.render('profile.ejs', {
  //       user: req.user,
  //       summaries: [],
  //       summary: "Please paste a transcript or upload audio file."
  //     })
  //   }

  //     // const { transcript } = req.body;
  //     // console.log('Transcript received:', transcript)

  //     const prompt = `Summarize the following podcast transcript. Write the summary as if you are the host speaking directly to your audience. 
  //     Make it conversational, friendly, and engaging:"${transcriptText}"`.trim()

      
  //     const response = await fetch(
  //       "https://router.huggingface.co/hf-inference/models/facebook/bart-large-cnn",
  //       {
  //         method: 'POST',
  //         headers: {Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": 'application/json'},
  //         body: JSON.stringify({
  //           inputs: prompt,
  //           parameters: {max_length: 250, min_length: 50, do_sample: true}
  //         })
  //       }
  //     )

  //     const data = await response.json();
  //     console.log('AI API response:', data)

  //     const summary = data[0]?.summary_text || "Could not get summary."
  //     console.log('Final summary:', summary)

  //     const hashtagPrompt = `Based on this podcast transcript, generate 5-10 short, SEO-friendly hashtags. 
  //     Only return the tag words (no "#", no explanations)."${transcriptText}"`.trim()

  //     const hashtagResponse = await fetch(
  //       "https://router.huggingface.co/hf-inference/models/facebook/bart-large-cnn",
  //       {
  //         method: "POST",
  //         headers: {Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": "application/json"},
  //         body: JSON.stringify({
  //           inputs: hashtagPrompt,
  //           parameters: {max_length: 60, min_length: 20}
  //         })
  //       }
  //     )

  //     const hashtagData = await hashtagResponse.json()

  //     let tags = hashtagData[0]?.summary_text || ""
  //     let hashtags = tags ? tags
  //     .replace(/#/g, "")
  //     .replace(/\.|\n/g, ",")
  //     .split(",")
  //     .map(tag => tag.trim())
  //     .filter(tag => tag.length > 2)
  //     .map(tag => "#" + tag.replace(/\s+/g, ""))
  //     .slice(0, 7) : []

  //     console.log("Hashtags:", hashtags)
      
      
  //     await db.collection('summaries').insertOne(
  //       {
  //         userId: req.user._id,
  //         summary: summary,
  //         hashtags: hashtags,
  //         dateOfSummary: new Date()
  //       })
        

       

  //         const summaries = await db.collection('summaries').find({userId: req.user._id}).sort({dateOfSummary: -1}).toArray();

  //         res.render('profile.ejs', {
  //           user: req.user,
  //           summaries: summaries,
  //           latestSummary: summary,
  //           latestHashtags: hashtags
  //         })
        
      
    
  //   } catch (err) {
  //     console.log('Error getting summary from AI:', err);
  //     res.render('profile.ejs', {
  //       user: req.user,
  //       summaries: [],
  //       summary: 'Error getting summary',
  //     })
    
  //   } finally {
  //     if (audioPath) {
  //       try {
  //         fs.unlinkSync(audioPath)
  //         console.log('Audio file deleted:', audioPath)
  //       }catch (unlinkErr) {
  //         console.log('Error deleting audio file:', unlinkErr)
  //       }
  //     }
  //   }

  //  })


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
