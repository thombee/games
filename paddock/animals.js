/*
 * The animals of the paddock: who they are, what can be offered to them, and how each mood
 * takes each offer. logic.js reads this; nothing here runs.
 *
 * Each animal has:
 *   kind, name, emoji, plural ("pigs", for the card titles)
 *   offers   id -> { emoji, label, loved }: `loved` is what the animal does when it loves it
 *   moods    in a fixed order; each has an icon, three hint lines (shown in turn, so the same
 *            mood reads differently the next time it comes round), the one offer it loves and
 *            the ones it likes. Every other offer is "not today".
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
          lines: ['Rosie is hot and bothered.', 'Rosie has gone pink in the sun.', 'Rosie is lying flat out in the heat.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'scratch', liked: ['straw'],
          lines: ['Rosie can barely keep her eyes open.', 'Rosie keeps nodding off.', 'Rosie is yawning her head off.'] },
        { id: 'peckish', icon: '🍎', word: 'peckish', loved: 'apple', liked: ['straw', 'scratch'],
          lines: ['Rosie looks peckish.', "Rosie's tummy is rumbling.", 'Rosie is snuffling about for windfalls.'] },
        { id: 'playful', icon: '🎈', word: 'playful', loved: 'ball', liked: ['mud'],
          lines: ['Rosie is in a silly mood.', 'Rosie keeps trotting in circles.', 'Rosie has the zoomies.'] },
        { id: 'nosy', icon: '👃', word: 'nosy', loved: 'straw', liked: ['apple', 'ball'],
          lines: ['Rosie wants to dig something up.', "Rosie's snout is twitching.", 'Rosie is rooting along the fence.'] },
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
          lines: ["Bert can't sit still.", 'Bert is pacing the fence line.', 'Bert keeps hopping on the spot.'] },
        { id: 'cheeky', icon: '😜', word: 'cheeky', loved: 'rock', liked: ['branch'],
          lines: ['Bert is up to something.', 'Bert has a glint in his eye.', 'Bert just nibbled your sleeve.'] },
        { id: 'bored', icon: '🥱', word: 'bored', loved: 'tyre', liked: ['rock', 'scratch'],
          lines: ['Bert looks bored stiff.', 'Bert is sighing at the gate.', 'Bert has seen it all before.'] },
        { id: 'peckish', icon: '🌿', word: 'peckish', loved: 'branch', liked: ['rock'],
          lines: ['Bert is eyeing the hedge.', 'Bert is chewing the fence post.', 'Bert looks peckish.'] },
        { id: 'grumpy', icon: '😤', word: 'grumpy', loved: 'scratch', liked: ['rock'],
          lines: ['Bert is in a huff.', 'Bert got up on the wrong side.', 'Bert is sulking by the trough.'] },
        { id: 'bouncy', icon: '⛰️', word: 'bouncy', loved: 'rock', liked: ['tyre', 'scratch'],
          lines: ['Bert is looking for somewhere high.', 'Bert is bouncing off the walls.', 'Bert keeps standing on things.'] },
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
          lines: ['Hazel looks peckish.', 'Hazel is pecking at nothing much.', 'Hazel is following you about hopefully.'] },
        { id: 'itchy', icon: '🪶', word: 'itchy', loved: 'dust', liked: ['leaves'],
          lines: ['Hazel keeps ruffling her feathers.', 'Hazel is scratching at an itch.', "Hazel's feathers are all on end."] },
        { id: 'broody', icon: '🥚', word: 'broody', loved: 'nest', liked: ['perch'],
          lines: ['Hazel wants some peace and quiet.', 'Hazel is muttering to herself.', 'Hazel is in a broody mood.'] },
        { id: 'busy', icon: '🔎', word: 'busy', loved: 'leaves', liked: ['corn', 'dust'],
          lines: ['Hazel is on a mission.', 'Hazel is turning over every stone.', "Hazel won't stop scratching about."] },
        { id: 'jumpy', icon: '👀', word: 'jumpy', loved: 'perch', liked: ['nest'],
          lines: ['Hazel jumped at a shadow.', 'Hazel is keeping a lookout.', 'Hazel is a bit on edge.'] },
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
          lines: ['Mabel is warm under all that wool.', 'Mabel is panting a little.', 'Mabel looks hot in her coat.'] },
        { id: 'peckish', icon: '🍀', word: 'peckish', loved: 'clover', liked: ['scratch'],
          lines: ['Mabel looks peckish.', 'Mabel is hunting for the sweet bits.', 'Mabel keeps sniffing your pockets.'] },
        { id: 'itchy', icon: '🧶', word: 'itchy', loved: 'scratch', liked: ['shade'],
          lines: ['Mabel is rubbing on the fence post.', "Mabel has an itch she can't reach.", 'Mabel keeps shaking her fleece.'] },
        { id: 'shy', icon: '🙈', word: 'shy', loved: 'clover', liked: ['song'],
          lines: ['Mabel is hanging back a bit.', 'Mabel is peeking from behind the tree.', 'Mabel is feeling shy.'] },
        { id: 'lonely', icon: '💭', word: 'lonely', loved: 'song', liked: ['scratch'],
          lines: ['Mabel keeps calling out.', 'Mabel looks a bit lonely.', 'Mabel is bleating at the gate.'] },
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
          lines: ['Maud is rubbing on the gatepost.', 'Maud keeps flicking her tail.', 'Maud is twisting round to lick her side.'] },
        { id: 'peckish', icon: '🌾', word: 'peckish', loved: 'hay', liked: ['brush'],
          lines: ['Maud looks peckish.', 'Maud is lowing at the trough.', 'Maud is nosing at the empty rack.'] },
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'hose', liked: ['music'],
          lines: ['Maud is standing in the only bit of shade.', 'Maud is swishing at flies in the heat.', 'Maud looks hot and heavy.'] },
        { id: 'dreamy', icon: '☁️', word: 'dreamy', loved: 'music', liked: ['chat', 'brush'],
          lines: ['Maud is in a dreamy mood.', 'Maud is chewing slowly, eyes half shut.', 'Maud is gazing at the clouds.'] },
        { id: 'chatty', icon: '💬', word: 'chatty', loved: 'chat', liked: ['music'],
          lines: ['Maud keeps mooing at you.', 'Maud wants a word.', 'Maud is calling across the paddock.'] },
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
          lines: ['Pip is flapping his wings at nothing.', 'Pip keeps waggling his tail.', 'Pip is restless for water.'] },
        { id: 'peckish', icon: '🟢', word: 'peckish', loved: 'peas', liked: ['puddle'],
          lines: ['Pip looks peckish.', 'Pip is quacking at your boots.', 'Pip is dabbling for crumbs.'] },
        { id: 'hot', icon: '☀️', word: 'hot', loved: 'sprinkler', liked: ['pool'],
          lines: ['Pip is panting with his bill open.', 'Pip is hot and grumpy.', 'Pip is hiding from the sun.'] },
        { id: 'nosy', icon: '🔎', word: 'nosy', loved: 'puddle', liked: ['peas'],
          lines: ['Pip is poking his bill into everything.', 'Pip is on the hunt.', 'Pip is busy sifting the grass.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'nook', liked: ['pool'],
          lines: ['Pip is dozing on one leg.', 'Pip is half asleep.', 'Pip keeps closing one eye.'] },
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
          lines: ['Norman is itchy all over.', 'Norman keeps eyeing the dusty patch.', 'Norman is rubbing on the gate.'] },
        { id: 'peckish', icon: '🥕', word: 'peckish', loved: 'carrot', liked: ['ears'],
          lines: ['Norman looks peckish.', 'Norman is sniffing your pockets.', 'Norman is nosing at the hedge.'] },
        { id: 'wary', icon: '👀', word: 'wary', loved: 'word', liked: ['carrot'],
          lines: ['Norman is keeping his distance.', "Norman isn't sure about something.", 'Norman is watching the gate very carefully.'] },
        { id: 'lonely', icon: '💭', word: 'lonely', loved: 'walk', liked: ['ears', 'word'],
          lines: ['Norman keeps braying at the gate.', 'Norman looks a bit lonely.', 'Norman is following you along the fence.'] },
        { id: 'dozy', icon: '😴', word: 'dozy', loved: 'ears', liked: ['word'],
          lines: ['Norman is dozing standing up.', "Norman's ears have drooped.", 'Norman is resting a back hoof.'] },
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
          lines: ['Gus is puffed up and showing off.', 'Gus is strutting about.', 'Gus has his best feathers out.'] },
        { id: 'peckish', icon: '🍇', word: 'peckish', loved: 'grapes', liked: ['dust'],
          lines: ['Gus looks peckish.', 'Gus is following you very closely.', 'Gus is pecking at your laces.'] },
        { id: 'itchy', icon: '🪶', word: 'itchy', loved: 'dust', liked: ['perch'],
          lines: ['Gus keeps preening one spot.', 'Gus is ruffled up and twitchy.', 'Gus is scratching at a bare patch.'] },
        { id: 'sleepy', icon: '😴', word: 'sleepy', loved: 'perch', liked: ['chat'],
          lines: ['Gus is looking for somewhere high.', "Gus's eyelids are drooping.", 'Gus has gone very quiet.'] },
        { id: 'chatty', icon: '💬', word: 'chatty', loved: 'chat', liked: ['applause', 'grapes'],
          lines: ['Gus has a lot to say today.', 'Gus gobbles at every noise.', "Gus's head has gone bright blue."] },
      ],
      liked: ['Gus gives a pleased little purr.', 'Gus puffs up a bit. Nice.', 'Gus clucks softly.'],
      notToday: ['Gus turns his back. Not today.', 'Gus gives a cross little putt.', "Gus isn't having it. Maybe tomorrow."],
      missed: ["Gus wondered where you'd got to.", 'Gus gobbles hello from across the paddock.'],
    },
  ];

  root.PADDOCK_ANIMALS = ANIMALS;
  if (typeof module !== 'undefined' && module.exports) module.exports = ANIMALS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
