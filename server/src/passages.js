// Built-in passages. Every one is at least 330 characters, so a 120 WPM typist (600 chars/min)
// cannot finish inside a 30 second race. Only characters from PASSAGE_CHARSET are used.

export const PASSAGES = Object.freeze([
  {
    id: 'p01',
    kind: 'prose',
    text: 'The night bus rolled past the shuttered bakery just as the first trays of bread went into the oven. Inside, two bakers argued softly about the radio, one wanting old songs and the other wanting the cricket score. Neither won. By the time the street lamps clicked off, the shelves were full, the floor was dusted white, and the argument had turned into a promise to settle it tomorrow.',
  },
  {
    id: 'p02',
    kind: 'prose',
    text: 'Rain had been falling on the hill station for three days, and the tea pickers had stopped pretending it would end. They worked in plastic capes the color of traffic cones, moving along the green rows like slow beads on a string. At noon a truck crawled up the road with hot rice and dal, and for twenty minutes nobody said a single word about the weather or the mud on their boots.',
  },
  {
    id: 'p03',
    kind: 'prose',
    text: 'My grandfather kept a toolbox that nobody else was allowed to open. When he finally let me look inside, I expected secret treasures. Instead there were labeled jars of screws, a pencil worn down to a stub, and a notebook listing every repair he had ever made in the house, with dates. The last entry said: kitchen tap, again. I still think about how patient that word again sounded.',
  },
  {
    id: 'p04',
    kind: 'prose',
    text: 'A good racing line is mostly about patience. You brake before the corner, not inside it, and you let the car settle before asking it to turn. Drivers who rush the entry lose more time than they gain, because the exit is where speed is really made. The same idea works far away from any track: slow down at the right moment, and the straight that follows becomes much easier.',
  },
  {
    id: 'p05',
    kind: 'prose',
    text: 'The lighthouse keeper wrote one line in the log every evening, even when nothing happened. Calm sea, clear sky. Wind from the west, two fishing boats home safe. Fog by midnight, horn sounded until dawn. Years later his daughter read the whole book in a single afternoon and realized it was not really a log at all. It was the most honest diary she had ever read, written by a quiet man.',
  },
  {
    id: 'p06',
    kind: 'prose',
    text: 'Every city has a sound that only shows up at four in the morning. Here it was the hum of a milk van, the slap of newspaper bundles hitting the pavement, and a dog somewhere that barked exactly three times and then gave up. I used to walk home through those streets after late shifts, and I learned that a city is never truly asleep. It is just taking turns with itself, very quietly.',
  },
  {
    id: 'p07',
    kind: 'prose',
    text: 'The kite festival began badly. The wind refused to show up, and hundreds of paper kites lay on the terraces like tired birds. Then, a little after three, a breeze came in from the river and the whole sky changed in a minute. Red, yellow, and violet shapes climbed above the rooftops, strings crossed, and the shouting started. By evening the children were hoarse and very happy.',
  },
  {
    id: 'p08',
    kind: 'prose',
    text: 'Learning to type fast is a strange kind of practice. At first you watch your fingers and every word feels like a small puzzle. Then one day you notice you are thinking in whole phrases, and the keys seem to move on their own. The trick is accuracy before speed. Every mistake you fix costs more than the second you saved by rushing, so slow, clean hands win the race in the end.',
  },
  {
    id: 'p09',
    kind: 'prose',
    text: 'The old train to the coast stopped at every village, whether anyone was waiting or not. Vendors climbed aboard with peanuts, cut guava, and sweet milky tea in tiny clay cups. Nobody was in a hurry, least of all the driver, who once waited five minutes for a woman running down the platform with a goat. She thanked him with a wave, and the goat looked deeply unimpressed by all of it.',
  },
  {
    id: 'p10',
    kind: 'prose',
    text: 'When the power went out across the whole block, the building changed character. Doors opened, candles appeared on the stairs, and neighbors who had nodded politely for years started trading stories in the corridor. Someone brought out a guitar with only five strings. Someone else made lemonade. When the lights came back two hours later, there was a groan, and then everyone went home.',
  },
  {
    id: 'p11',
    kind: 'prose',
    text: 'Mountain guides have a saying that the summit is optional but the descent is mandatory. It sounds like a joke until you are standing near the top, tired and cold, with the weather turning. Then it becomes the most useful sentence in the world. Turning back is not failure; it is the plan working. The mountain will be there next season, and so, if you choose well today, will you.',
  },
  {
    id: 'p12',
    kind: 'prose',
    text: 'The library smelled of dust, glue, and floor polish. On rainy afternoons it filled with students pretending to study and retired men reading every page of the newspaper, including the shipping news. The librarian knew everyone by the books they returned late. She never charged the fines. She just raised one eyebrow, slowly, and that was always more than enough to fix the problem.',
  },
  {
    id: 'p13',
    kind: 'quote',
    text: 'A stitch in time saves nine. Many hands make light work. Actions speak louder than words. Still waters run deep. The early bird catches the worm, but the second mouse gets the cheese. Do not count your chickens before they hatch. Every cloud has a silver lining. Practice makes perfect. Rome was not built in a day. Slow and steady wins the race, and fortune favors the brave.',
  },
  {
    id: 'p14',
    kind: 'quote',
    text: 'Where there is a will, there is a way. Two heads are better than one. When in Rome, do as the Romans do. Better late than never. A journey of a thousand miles begins with a single step. Do not put all your eggs in one basket. Look before you leap. The pen is mightier than the sword. Necessity is the mother of invention. All good things come to those who wait, and keep typing.',
  },
  {
    id: 'c01',
    kind: 'code',
    text: 'git status; git add .; git commit -m "fix: handle empty input in the parser"; git pull --rebase origin main; npm test; git push origin main. If the tests fail, read the first error, not the last one. The first error usually explains the rest. Run git log --oneline -n 5 to check what changed, then try again with a clear head and a fresh cup of tea.',
  },
  {
    id: 'c02',
    kind: 'code',
    text: 'for line in open("server.log"): print(line.strip()). That one line reads a whole log file. Add if "ERROR" in line: before the print and you have a tiny filter. Wrap it in def scan(path): and call scan("server.log") from anywhere. Small tools like this save hours, because you stop scrolling through noise and start reading only the lines that matter to you.',
  },
  {
    id: 'c03',
    kind: 'code',
    text: 'console.log("ready"); socket.on("connect", join); socket.on("disconnect", retry); socket.on("state", render); The client listens for two events and reacts to both. When the network drops, it waits a moment, then reconnects and asks the server for the latest state. The server never trusts the client about positions; it only accepts intents like ready or progress.',
  },
  {
    id: 'c04',
    kind: 'code',
    text: 'SELECT name, score FROM players WHERE score BETWEEN 90 AND 100 ORDER BY score DESC LIMIT 10; This query returns the top ten players. Add an index on the score column and it stays fast as the table grows. Forget the index, and one day the leaderboard page takes nine seconds to load, and everyone on the team suddenly remembers how databases actually work under the hood.',
  },
  {
    id: 'c05',
    kind: 'code',
    text: 'mkdir lane; cd lane; npm init -y; npm install express socket.io; node server.js. Five commands and you have a running server. The hard part is not the setup. The hard part is deciding what the server owns. Keep one source of truth, validate every message, and treat each client as a friendly stranger who might be having a very bad day with a slow network connection.',
  },
  {
    id: 'c06',
    kind: 'code',
    text: 'def wpm(chars, seconds): return (chars / 5) / (seconds / 60). Five characters count as one word, so typing 300 correct characters in one minute is sixty words per minute. Accuracy is the share of keys that were right. Raw speed counts every key you pressed, mistakes included. Net speed only counts what you actually got right, which is the number that wins races.',
  },
]);

export function pickPassage(passages = PASSAGES, previousId = null, random = Math.random) {
  const pool = passages.length > 1 ? passages.filter((p) => p.id !== previousId) : passages;
  return pool[Math.floor(random() * pool.length)];
}
