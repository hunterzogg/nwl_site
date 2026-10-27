const { sql } = require('./lib/db');

// Public: returns published questions for a given week (default: all published, most recent week first).
// closest_diff is the smallest miss on a graded number_guess question with a closest_bonus, so the page
// can show who earned the closest-guess bonus (null otherwise).
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const week = req.query.week;
  const rows = (await sql.query(`
    SELECT q.id, q.week, q.season, q.type, q.prompt, q.option_a, q.option_b, q.points, q.lock_at,
      q.correct_option, q.tolerance, q.closest_bonus,
      (SELECT MIN(ABS(p.choice::numeric - q.correct_option::numeric))
         FROM picks p
        WHERE p.question_id = q.id AND q.closest_bonus IS NOT NULL AND q.type = 'number_guess'
          AND p.choice ~ '^-?[0-9]+(\\.[0-9]+)?$' AND q.correct_option ~ '^-?[0-9]+(\\.[0-9]+)?$') AS closest_diff
    FROM questions q
    WHERE q.published = true ${week ? 'AND q.week = $1' : ''}
    ORDER BY ${week ? 'q.id' : 'q.week DESC, q.id'}
  `, week ? [week] : [])).rows;

  res.status(200).json(rows);
};
