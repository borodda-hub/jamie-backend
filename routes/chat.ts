import express from 'express';
import { getJamieResponse, scoreDQ } from '../utils/openai';
import { jamieSystemPrompt } from '../utils/prompts';

const router = express.Router();

router.post('/', async (req, res) => {
  const userMessage: string = req.body.message;
  const sessionId: string = req.body.session_id || 'anon-session';
  const userId: string = req.body.user_id || 'anon-user';

  try {
    console.log("Received message:", userMessage);

    const jamieReply = await getJamieResponse(userMessage, jamieSystemPrompt);
    console.log("Jamie reply:", jamieReply);

    const dqScore = await scoreDQ(userMessage);
    console.log("DQ Score:", dqScore);

    const response = {
      session_id: sessionId,
      user_id: userId,
      user_message: userMessage,
      jamie_reply: jamieReply,
      dq_score: dqScore,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);

  } catch (err) {
    console.error("Error processing chat:", err);
    res.status(500).send('Failed to process message.');
  }
});

module.exports = router;
