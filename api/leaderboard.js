const { sql } = require('./lib/db');

// A pick is correct if it exactly matches the graded answer - except number_guess questions,
// which are "correct" within +/-2 of the real number (e.g. "how many tendies get eaten"),
// not an exact match. The regex guards let malformed choice/correct_option values (shouldn't
// happen given write-time validation, but defensive) fall through to a normal string compare
// instead of erroring the whole query on a bad ::numeric cast.
const CORRECT_CASE = `
  CASE
    WHEN q.type = 'number_guess'
      AND p.choice ~ '^-?[0-9]+(\\.[0-9]+)?$'
      AND q.correct_option ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN ABS(p.choice::numeric - q.correct_option::numeric) <= 2
    ELSE p.choice = q.correct_option
  END
`;

// Public: season-to-date leaderboard, plus each manager's points for the most recent graded week.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const season = (await sql.query(`
    SELECT p.manager,
      SUM(CASE WHEN ${CORRECT_CASE} THEN q.points ELSE 0 END) AS points,
      COUNT(*) FILTER (WHERE q.correct_option IS NOT NULL) AS graded_picks
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    GROUP BY p.manager
    ORDER BY points DESC
  `)).rows;

  const latestWeekRow = (await sql`
    SELECT MAX(week) AS week FROM questions WHERE correct_option IS NOT NULL
  `).rows[0];
  const latestWeek = latestWeekRow ? latestWeekRow.week : null;

  const thisWeek = latestWeek !== null
    ? (await sql.query(`
        SELECT p.manager,
          SUM(CASE WHEN ${CORRECT_CASE} THEN q.points ELSE 0 END) AS points
        FROM picks p
        JOIN questions q ON q.id = p.question_id
        WHERE q.week = $1
        GROUP BY p.manager
      `, [latestWeek])).rows
    : [];

  res.status(200).json({ season, latest_week: latestWeek, this_week: thisWeek });
};
