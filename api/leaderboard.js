const { sql } = require('./lib/db');

// Public: season-to-date leaderboard, plus each manager's points for the most recent graded week.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const season = (await sql`
    SELECT p.manager,
      SUM(CASE WHEN p.choice = q.correct_option THEN q.points ELSE 0 END) AS points,
      COUNT(*) FILTER (WHERE q.correct_option IS NOT NULL) AS graded_picks
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    GROUP BY p.manager
    ORDER BY points DESC
  `).rows;

  const latestWeekRow = (await sql`
    SELECT MAX(week) AS week FROM questions WHERE correct_option IS NOT NULL
  `).rows[0];
  const latestWeek = latestWeekRow ? latestWeekRow.week : null;

  const thisWeek = latestWeek
    ? (await sql`
        SELECT p.manager,
          SUM(CASE WHEN p.choice = q.correct_option THEN q.points ELSE 0 END) AS points
        FROM picks p
        JOIN questions q ON q.id = p.question_id
        WHERE q.week = ${latestWeek}
        GROUP BY p.manager
      `).rows
    : [];

  res.status(200).json({ season, latest_week: latestWeek, this_week: thisWeek });
};
