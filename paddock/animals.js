/*
 * The animals of the paddock: who they are, what can be offered to them, and how each mood
 * takes each offer. logic.js reads this; nothing here runs.
 *
 * Each animal has:
 *   kind, name, emoji, plural ("pigs", for the card titles)
 *   offers   id -> { emoji, label, loved }: `loved` is what the animal does when it loves it
 *   moods    in a fixed order; each has an icon, three hint lines (shown in turn, so the same
 *            mood reads differently the next time it comes round), the one offer it loves and
 *            the ones it likes. Every other offer is "not today". A mood's three lines share
 *            one clue to what it loves, and never name the offer itself.
 *   liked, notToday   three lines each, picked by day so two days running never match
 *   missed   two greetings for a player who has been away three days or more
 */
(function (root) {
  'use strict';

  var ANIMALS = [
    {
      kind: 'pig', name: 'Rosie', emoji: '🐖', plural: 'pigs',
      offers: {
        mud: { emoji: '🟤', label: 'A mud wallow', loved: 'Rosie flops into the mud and rolls right over.' },
        apple: { emoji: '🍎', label: 'An apple', loved: 'Rosie crunches it in two bites and grunts for more.' },
        scratch: { emoji: '🫳', label: 'A belly scratch', loved: 'Rosie topples over sideways for a proper belly scratch.' },
        straw: { emoji: '🌾', label: 'A heap of straw', loved: 'Rosie buries her snout in it and snuffles away.' },
        ball: { emoji: '⚽', label: 'A ball to push', loved: 'Rosie chases the ball round the paddock, squeaking.' },
      },
      moods: [
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'mud', liked: ['apple'],
          lines: ['Rosie is hot and looking for somewhere damp.', 'Rosie has gone pink and wants to cool off.', 'Rosie is flat out in the heat, panting.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'scratch', liked: ['straw'],
          lines: ['Rosie is dozy and keeps rolling onto her side.', 'Rosie yawns and flops over, tummy up.', 'Rosie is half asleep, sprawled on her side.'] },
        { id: 'peckish', icon: '🍎', word: 'peckish', loved: 'apple', liked: ['straw', 'scratch'],
          lines: ['Rosie is hungry and snuffling for windfalls.', 'Rosie is hungry and nosing under the tree.', 'Rosie is hungry and hunting for fallen fruit.'] },
        { id: 'playful', icon: '🎈', word: 'playful', loved: 'ball', liked: ['mud'],
          lines: ['Rosie keeps nosing a pine cone along to chase.', 'Rosie is rolling a bucket about with her snout.', 'Rosie is chasing anything that rolls.'] },
        { id: 'nosy', icon: '👃', word: 'nosy', loved: 'straw', liked: ['apple', 'ball'],
          lines: ['Rosie is rooting along the fence with her snout.', 'Rosie wants something to bury her snout in.', 'Rosie is digging little holes with her snout.'] },
      ],
      liked: ['Rosie gives a pleased little grunt.', 'Rosie wags her curly tail.', 'Rosie gives it a sniff and a nudge.'],
      notToday: ['Rosie gives you a look. Not today.', "Rosie isn't in the mood for that.", 'Rosie turns her back. Maybe tomorrow.'],
      missed: ["Rosie wondered where you'd got to.", 'Rosie trots over. She missed you.'],
    },
    {
      kind: 'goat', name: 'Bert', emoji: '🐐', plural: 'goats',
      offers: {
        rock: { emoji: '🪨', label: 'A rock to climb', loved: 'Bert is up on top in one leap, very pleased with himself.' },
        branch: { emoji: '🌿', label: 'A leafy branch', loved: 'Bert strips every leaf and wags his tail.' },
        scratch: { emoji: '🫳', label: 'A chin scratch', loved: 'Bert leans his whole head into your hand.' },
        tyre: { emoji: '🛞', label: 'An old tyre', loved: 'Bert butts it, stands on it, then butts it again.' },
      },
      moods: [
        { id: 'restless', icon: '🌀', word: 'restless', loved: 'rock', liked: ['tyre'],
          lines: ['Bert is pacing and peering up at the wall.', "Bert can't settle, and keeps looking upwards.", 'Bert paces the fence, eyeing the high ground.'] },
        { id: 'cheeky', icon: '😜', word: 'cheeky', loved: 'rock', liked: ['branch'],
          lines: ['Bert has hopped up onto the feed bin again.', 'Bert is standing on the wheelbarrow, grinning.', 'Bert keeps sneaking up onto the bench.'] },
        { id: 'bored', icon: '🥱', word: 'bored', loved: 'tyre', liked: ['rock', 'scratch'],
          lines: ['Bert is butting the gate for something to do.', 'Bert is idly headbutting the fence post.', 'Bert is bored and butting a bucket about.'] },
        { id: 'peckish', icon: '🌿', word: 'peckish', loved: 'branch', liked: ['rock'],
          lines: ['Bert is stretching up to strip the hedge.', 'Bert is on his back legs, nibbling the tree.', 'Bert is hungry and reaching up into the hedge.'] },
        { id: 'grumpy', icon: '😤', word: 'grumpy', loved: 'scratch', liked: ['rock'],
          lines: ['Bert is in a huff, rubbing his jaw on the post.', 'Bert is sulking and grinding his head on the gate.', 'Bert is grumpy and rubbing his face on the fence.'] },
        { id: 'bouncy', icon: '⛰️', word: 'bouncy', loved: 'rock', liked: ['tyre', 'scratch'],
          lines: ['Bert keeps springing off every tussock.', 'Bert is leaping off every bump in the grass.', 'Bert is bouncing about, looking for a launch pad.'] },
      ],
      liked: ['Bert gives it a go.', 'Bert flicks his ears. Not bad.', 'Bert gives a short, cheerful bleat.'],
      notToday: ['Bert walks off. Not today.', "Bert sniffs it and isn't impressed.", 'Bert gives you a long stare.'],
      missed: ["Bert wondered where you'd got to.", 'Bert bleats at you. Where have you been?'],
    },
    {
      kind: 'hen', name: 'Hazel', emoji: '🐓', plural: 'hens',
      offers: {
        corn: { emoji: '🌽', label: 'A scatter of corn', loved: 'Hazel pecks up every last bit, clucking away.' },
        dust: { emoji: '🟫', label: 'A dust bath', loved: 'Hazel wriggles down and flings dust everywhere.' },
        nest: { emoji: '🪺', label: 'A quiet nest box', loved: 'Hazel settles in and croons softly.' },
        leaves: { emoji: '🍂', label: 'A pile of leaves', loved: 'Hazel scratches the whole pile flat in seconds.' },
        perch: { emoji: '🪵', label: 'A high perch', loved: 'Hazel hops up and fluffs out, queen of the paddock.' },
      },
      moods: [
        { id: 'peckish', icon: '🌽', word: 'peckish', loved: 'corn', liked: ['leaves'],
          lines: ['Hazel is hungry and pecking at bare ground.', 'Hazel is hungry and pecking at your boots.', 'Hazel is hungry and pecking round the tin.'] },
        { id: 'itchy', icon: '🪶', word: 'itchy', loved: 'dust', liked: ['leaves'],
          lines: ['Hazel is itchy and scraping at a dry hollow.', 'Hazel is itchy and shaking out her feathers.', 'Hazel is itchy and flicking dry earth on her back.'] },
        { id: 'broody', icon: '🥚', word: 'broody', loved: 'nest', liked: ['perch'],
          lines: ['Hazel is hunting for a snug, hidden spot.', 'Hazel keeps trying to tuck herself away.', 'Hazel wants somewhere tucked away to sit.'] },
        { id: 'busy', icon: '🔎', word: 'busy', loved: 'leaves', liked: ['corn', 'dust'],
          lines: ['Hazel is raking the ground, hunting for bugs.', 'Hazel is flicking things over, hunting for bugs.', 'Hazel is busy hunting for bugs in the grass.'] },
        { id: 'jumpy', icon: '👀', word: 'jumpy', loved: 'perch', liked: ['nest'],
          lines: ['Hazel jumped at a shadow and is looking up.', 'Hazel is on edge and eyeing the fence top.', 'Hazel is jumpy and wants to be off the ground.'] },
      ],
      liked: ['Hazel gives a cheerful cluck.', 'Hazel tilts her head. Not bad.', 'Hazel makes a pleased little trill.'],
      notToday: ['Hazel stalks off. Not today.', 'Hazel gives it one peck and loses interest.', 'Hazel clucks crossly. Maybe tomorrow.'],
      missed: ["Hazel wondered where you'd got to.", 'Hazel comes running. She missed you.'],
    },
    {
      kind: 'sheep', name: 'Mabel', emoji: '🐑', plural: 'sheep',
      offers: {
        shade: { emoji: '🌳', label: 'A shady tree', loved: 'Mabel settles in the shade with a long, happy sigh.' },
        clover: { emoji: '🍀', label: 'A handful of clover', loved: 'Mabel nibbles it from your hand, eyes half closed.' },
        scratch: { emoji: '🫳', label: 'A back scratch', loved: 'Mabel leans in until her back leg starts to twitch.' },
        song: { emoji: '🎵', label: 'A soft song', loved: 'Mabel comes close and listens to every note.' },
      },
      moods: [
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'shade', liked: ['clover'],
          lines: ['Mabel is hot and squinting in the sun.', 'Mabel is hot and panting under her wool.', 'Mabel is hot and wants to get out of the sun.'] },
        { id: 'peckish', icon: '🍀', word: 'peckish', loved: 'clover', liked: ['scratch'],
          lines: ['Mabel is hungry and picking out the best bits.', 'Mabel is hungry and sniffing your hands.', 'Mabel is hungry and hunting for something sweet.'] },
        { id: 'itchy', icon: '🧶', word: 'itchy', loved: 'scratch', liked: ['shade'],
          lines: ["Mabel has an itch she can't reach.", 'Mabel is rubbing herself along the fence.', 'Mabel is twisting round to nibble an itch.'] },
        { id: 'shy', icon: '🙈', word: 'shy', loved: 'clover', liked: ['song'],
          lines: ['Mabel stays shy, but keeps eyeing your hand.', 'Mabel is shy, and peeking at your hand.', 'Mabel is shy, but might come for a treat.'] },
        { id: 'lonely', icon: '💭', word: 'lonely', loved: 'song', liked: ['scratch'],
          lines: ['Mabel keeps calling out and listening.', 'Mabel is lonely and bleating for a reply.', 'Mabel is lonely, ears pricked for a voice.'] },
      ],
      liked: ['Mabel gives a soft little baa.', 'Mabel flicks an ear. Nice.', 'Mabel stays close for a moment.'],
      notToday: ['Mabel trots off. Not today.', "Mabel isn't sure about that.", 'Mabel looks away politely.'],
      missed: ["Mabel wondered where you'd got to.", 'Mabel knows your face. She baas hello.'],
    },
    {
      kind: 'cow', name: 'Maud', emoji: '🐄', plural: 'cows',
      offers: {
        brush: { emoji: '🧹', label: 'A big brush', loved: 'Maud leans into the bristles and stretches her neck right out.' },
        hay: { emoji: '🌾', label: 'Sweet hay', loved: 'Maud buries her nose in it and chews, content.' },
        hose: { emoji: '💦', label: 'A cool hose-down', loved: 'Maud stands in the spray, blinking happily.' },
        music: { emoji: '🎶', label: 'Some music', loved: "Maud's ears swivel and she sways along." },
        chat: { emoji: '💬', label: 'A quiet chat', loved: 'Maud gives a low moo back, as if she is answering.' },
      },
      moods: [
        { id: 'itchy', icon: '🪰', word: 'itchy', loved: 'brush', liked: ['chat'],
          lines: ['Maud is itchy and rubbing on the gatepost.', 'Maud is itchy and scraping along the fence.', 'Maud is itchy and twisting round to lick it.'] },
        { id: 'peckish', icon: '🌾', word: 'peckish', loved: 'hay', liked: ['brush'],
          lines: ['Maud is hungry and nosing the empty rack.', 'Maud is lowing at the empty rack.', 'Maud keeps licking the bottom of the rack.'] },
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'hose', liked: ['music'],
          lines: ['Maud is hot and standing in the trough.', 'Maud is hot and dunking her nose in the trough.', 'Maud is hot and wading in a puddle.'] },
        { id: 'dreamy', icon: '☁️', word: 'dreamy', loved: 'music', liked: ['chat', 'brush'],
          lines: ['Maud is swaying gently to the birdsong.', 'Maud is dreamy, her ears following a blackbird.', 'Maud is gazing at the clouds, humming a low moo.'] },
        { id: 'chatty', icon: '💬', word: 'chatty', loved: 'chat', liked: ['music'],
          lines: ['Maud keeps mooing at you, then waiting.', 'Maud moos at you as if expecting an answer.', 'Maud lows at you and tilts her head.'] },
      ],
      liked: ['Maud gives a slow, pleased blink.', 'Maud swishes her tail. Nice.', 'Maud breathes out warmly on your hand.'],
      notToday: ['Maud turns away. Not today.', "Maud isn't fussed about that.", 'Maud gives you a long, patient look.'],
      missed: ["Maud wondered where you'd got to.", 'Maud lows when she sees you coming.'],
    },
    {
      kind: 'duck', name: 'Pip', emoji: '🦆', plural: 'ducks',
      offers: {
        pool: { emoji: '💧', label: 'A paddling pool', loved: 'Pip dives in, tail up, and comes out beaming.' },
        peas: { emoji: '🟢', label: 'A handful of peas', loved: 'Pip hoovers them up with a happy quack.' },
        sprinkler: { emoji: '⛲', label: 'A sprinkler', loved: 'Pip runs through it again and again.' },
        puddle: { emoji: '🟤', label: 'A muddy puddle', loved: 'Pip dabbles through every inch of it.' },
        nook: { emoji: '🪺', label: 'A cosy corner', loved: 'Pip tucks his bill under a wing and dozes off.' },
      },
      moods: [
        { id: 'splashy', icon: '🌊', word: 'splashy', loved: 'pool', liked: ['sprinkler'],
          lines: ['Pip keeps bobbing his head as if diving.', 'Pip is practising dives on the dry grass.', 'Pip is waggling his tail, longing for a swim.'] },
        { id: 'peckish', icon: '🟢', word: 'peckish', loved: 'peas', liked: ['puddle'],
          lines: ['Pip is hungry and quacking at your hands.', 'Pip is hungry and nibbling at your fingers.', 'Pip is hungry and watching your hands.'] },
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'sprinkler', liked: ['pool'],
          lines: ['Pip is hot and standing under the dripping tap.', 'Pip is hot and turning his face up for rain.', 'Pip is hot and hoping for a shower.'] },
        { id: 'nosy', icon: '🔎', word: 'nosy', loved: 'puddle', liked: ['peas'],
          lines: ['Pip is sifting the wet ground with his bill.', 'Pip is slurping through the soggy grass.', 'Pip is dabbling his bill in every damp spot.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'nook', liked: ['pool'],
          lines: ['Pip is drowsy and looking for somewhere snug.', 'Pip is half asleep and edging out of the wind.', 'Pip is yawning, hunting for a sheltered spot.'] },
      ],
      liked: ['Pip gives a cheerful quack.', 'Pip waggles his tail.', 'Pip shakes out his feathers, pleased.'],
      notToday: ['Pip waddles off. Not today.', 'Pip gives a grumpy little quack.', "Pip isn't interested. Maybe tomorrow."],
      missed: ["Pip wondered where you'd got to.", 'Pip waddles over, quacking. He missed you.'],
    },
    {
      kind: 'donkey', name: 'Norman', emoji: '🫏', plural: 'donkeys',
      offers: {
        roll: { emoji: '🟫', label: 'A dusty patch', loved: 'Norman rolls over twice and gets up looking very smug.' },
        carrot: { emoji: '🥕', label: 'A carrot', loved: 'Norman crunches it slowly, savouring every bite.' },
        ears: { emoji: '🫳', label: 'An ear rub', loved: "Norman's eyes go soft and his head drops low." },
        walk: { emoji: '🚶', label: 'A stroll together', loved: 'Norman walks at your shoulder all the way round.' },
        word: { emoji: '💬', label: 'A quiet word', loved: 'Norman steps closer, both ears turned towards you.' },
      },
      moods: [
        { id: 'itchy', icon: '🪶', word: 'itchy', loved: 'roll', liked: ['ears'],
          lines: ['Norman is itchy and pawing at the dry ground.', 'Norman is itchy and bending his knees to lie down.', 'Norman is itchy all over and pawing the earth.'] },
        { id: 'peckish', icon: '🥕', word: 'peckish', loved: 'carrot', liked: ['ears'],
          lines: ['Norman is hungry and nosing at your pockets.', 'Norman is hungry and sniffing your coat.', 'Norman is hungry and nuzzling your pocket.'] },
        { id: 'wary', icon: '👀', word: 'wary', loved: 'word', liked: ['carrot'],
          lines: ['Norman is wary, ears swivelling at every sound.', 'Norman is keeping his distance, ears twitching.', 'Norman is uneasy and listening hard.'] },
        { id: 'lonely', icon: '💭', word: 'lonely', loved: 'walk', liked: ['ears', 'word'],
          lines: ['Norman is lonely and following you along the fence.', 'Norman is lonely and trailing after you.', 'Norman is lonely and falling into step with you.'] },
        { id: 'dozy', icon: '😴', word: 'dozy', loved: 'ears', liked: ['word'],
          lines: ['Norman is dozing, his head drooping low.', 'Norman is drowsy and lowering his head to you.', 'Norman is dozy and resting his head on the gate.'] },
      ],
      liked: ['Norman gives a soft snort.', 'Norman flicks one long ear your way.', 'Norman nudges your arm, gently.'],
      notToday: ['Norman plants his hooves. Not today.', 'Norman thinks about it, and says no.', 'Norman looks at you sideways. Maybe tomorrow.'],
      missed: ["Norman wondered where you'd got to.", 'Norman brays the moment he sees you.'],
    },
    {
      kind: 'turkey', name: 'Gus', emoji: '🦃', plural: 'turkeys',
      offers: {
        applause: { emoji: '👏', label: 'A round of applause', loved: 'Gus fans his tail and struts a lap of honour.' },
        grapes: { emoji: '🍇', label: 'A bunch of grapes', loved: 'Gus takes them one by one, very politely.' },
        dust: { emoji: '🟫', label: 'A dust bath', loved: 'Gus sinks down and shuffles dust into every feather.' },
        perch: { emoji: '🌳', label: 'A branch to roost on', loved: 'Gus flaps up and settles, looking very grand.' },
        chat: { emoji: '💬', label: 'A chat', loved: 'Gus gobbles back at every word you say.' },
      },
      moods: [
        { id: 'proud', icon: '🎩', word: 'proud', loved: 'applause', liked: ['chat'],
          lines: ['Gus is puffed up and showing off.', 'Gus is strutting up and down for an audience.', 'Gus has his tail fanned out, waiting to be admired.'] },
        { id: 'peckish', icon: '🍇', word: 'peckish', loved: 'grapes', liked: ['dust'],
          lines: ['Gus is hungry and pecking at your buttons.', 'Gus is hungry and pecking at berries in the hedge.', 'Gus is hungry and eyeing anything small and round.'] },
        { id: 'itchy', icon: '🪶', word: 'itchy', loved: 'dust', liked: ['perch'],
          lines: ['Gus is itchy and preening the same spot.', 'Gus is itchy and scraping out a dry hollow.', 'Gus is itchy and flicking earth over himself.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'perch', liked: ['chat'],
          lines: ['Gus is sleepy and looking for somewhere up high.', 'Gus is drowsy and gazing up into the oak.', 'Gus is yawning and peering up at the tree.'] },
        { id: 'chatty', icon: '💬', word: 'chatty', loved: 'chat', liked: ['applause', 'grapes'],
          lines: ['Gus answers every noise with a gobble.', 'Gus keeps gobbling whenever you speak.', 'Gus gobbles at you, then waits for a reply.'] },
      ],
      liked: ['Gus gives a pleased little purr.', 'Gus puffs up a bit. Nice.', 'Gus clucks softly.'],
      notToday: ['Gus turns his back. Not today.', 'Gus gives a cross little putt.', "Gus isn't having it. Maybe tomorrow."],
      missed: ["Gus wondered where you'd got to.", 'Gus gobbles hello from across the paddock.'],
    },
  ];

  root.PADDOCK_ANIMALS = ANIMALS;
  if (typeof module !== 'undefined' && module.exports) module.exports = ANIMALS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
