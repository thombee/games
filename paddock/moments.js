/*
 * Moments: short scenes between two of the player's animals. About once a week, picked by the
 * calendar day so friends see the same one, a moment plays when the paddock opens, if both of
 * its animals have arrived. logic.js decides when; nothing here runs.
 *
 * Each moment has an id (kept in saves, so never change one), the two animals it is about, a
 * title for the book, and two or three lines. There is one for every pair of animals.
 */
(function (root) {
  'use strict';

  var MOMENTS = [
    { id: 'room-in-the-mud', kinds: ['pig', 'hen'], title: 'Room in the mud', lines: [
      'Rosie has the coolest corner of her mud all to herself.',
      'Hazel tiptoes along the edge, pecking at the dry bits.',
      'Rosie shuffles over a little, and Hazel stays.'] },
    { id: 'the-sunny-spot', kinds: ['goat', 'cow'], title: 'The sunny spot', lines: [
      'Maud gets up from her favourite sunny spot for a stretch.',
      'Bert is lying in it before she has turned round.',
      'Maud looks at him for a long while, then lies down right beside him.'] },
    { id: 'a-nibble-too-far', kinds: ['pig', 'goat'], title: 'A nibble too far', lines: [
      "Bert gives the tip of Rosie's ear a nibble.",
      'Rosie squeals and chases him twice round the trough.',
      'Later they doze back to back in the sun.'] },
    { id: 'the-lookout', kinds: ['goat', 'hen'], title: 'The lookout', lines: [
      "Hazel hops up onto Bert's back for a better view.",
      'Bert stands very still, chewing, while she has a good look round.'] },
    { id: 'not-that-high', kinds: ['goat', 'sheep'], title: 'Not that high', lines: [
      'Bert bounds up the big rock and bleats down at Mabel to follow.',
      'Mabel takes one look and stays exactly where she is.',
      'Bert hops back down and stands with her instead.'] },
    { id: 'tidying-up', kinds: ['hen', 'sheep'], title: 'Tidying up', lines: [
      'Mabel lies down in the warm grass.',
      'Hazel picks the burrs out of her fleece, one by one.',
      'Mabel closes her eyes and lets her.'] },
    { id: 'nose-to-nose', kinds: ['pig', 'sheep'], title: 'Nose to nose', lines: [
      'Rosie trots up to Mabel, snout first.',
      'Mabel sniffs back, very politely.',
      'They nap side by side until the shade moves.'] },
    { id: 'a-moving-shade', kinds: ['pig', 'cow'], title: 'A moving shade', lines: [
      "Rosie trots under Maud's chin to keep out of the sun.",
      'Maud stands very still so the shade stays put.'] },
    { id: 'fly-patrol', kinds: ['hen', 'cow'], title: 'Fly patrol', lines: [
      "Hazel perches on Maud's back and snaps at the flies.",
      'Maud swishes her tail, carefully missing Hazel every time.'] },
    { id: 'calling-across', kinds: ['sheep', 'cow'], title: 'Calling across', lines: [
      'Maud lows softly, and Mabel answers from the far side of the paddock.',
      'They meet in the middle and stand nose to nose.',
      'Then they both go back to grazing, satisfied.'] },
    { id: 'the-same-colour', kinds: ['pig', 'duck'], title: 'The same colour', lines: [
      "Pip waddles into Rosie's mud for a dabble.",
      'Rosie watches, puzzled, then rolls in beside him.',
      'They come out exactly the same colour.'] },
    { id: 'the-beetle', kinds: ['hen', 'duck'], title: 'The beetle', lines: [
      'Pip and Hazel spot the same beetle at the same moment.',
      'They look at each other. Then at the beetle.',
      'The beetle strolls off while they are still deciding.'] },
    { id: 'hands-off', kinds: ['goat', 'duck'], title: 'Hands off', lines: [
      "Bert gives Pip's tail feathers a curious sniff.",
      'Pip quacks, deeply offended.',
      'Bert backs away and pretends to admire a cloud.'] },
    { id: 'bubbles', kinds: ['cow', 'duck'], title: 'Bubbles', lines: [
      "Pip is splashing about in Maud's water trough.",
      'Maud dips her nose in and blows bubbles at him.',
      'Pip dabbles happily through every one.'] },
    { id: 'a-long-look', kinds: ['goat', 'donkey'], title: 'A long look', lines: [
      "Bert leaps onto the fence right beside Norman's head.",
      'Norman gives him a long, slow look.',
      'Bert gets down. Norman goes back to his doze.'] },
    { id: 'on-guard', kinds: ['sheep', 'donkey'], title: 'On guard', lines: [
      'Mabel naps in the long grass while Norman stands over her.',
      'Every time a crow lands, one of his ears swivels round to it.',
      'Mabel sleeps on, perfectly safe.'] },
    { id: 'at-the-gate', kinds: ['pig', 'donkey'], title: 'At the gate', lines: [
      'Norman and Rosie meet at the gate and touch noses, once.',
      'Rosie trots off, and Norman ambles after her, a few steps behind.'] },
    { id: 'a-small-shadow', kinds: ['duck', 'donkey'], title: 'A small shadow', lines: [
      'Pip has been following Norman about all morning.',
      'Norman stops. Pip stops. Norman walks on. Pip walks on.',
      'Norman gives a long sigh and lets him tag along.'] },
    { id: 'unimpressed', kinds: ['hen', 'turkey'], title: 'Unimpressed', lines: [
      'Gus fans out his tail right in front of Hazel.',
      'Hazel carries on scratching and never once looks up.',
      'Gus quietly folds his tail away again.'] },
    { id: 'the-last-word', kinds: ['goat', 'turkey'], title: 'The last word', lines: [
      'Gus gobbles at Bert. Bert bleats back.',
      'They keep it up until both of them forget what it was about.'] },
    { id: 'a-lap-of-honour', kinds: ['cow', 'turkey'], title: 'A lap of honour', lines: [
      'Gus struts a slow circle all the way round Maud.',
      'Maud turns her head to watch him go, chewing.',
      'When he finishes, she gives one low moo, as if to say well done.'] },
    { id: 'whose-puddle', kinds: ['duck', 'turkey'], title: 'Whose puddle', lines: [
      'Gus and Pip have a loud disagreement about a puddle.',
      'Nobody wins.',
      'In the end they stand in it together.'] },
    { id: 'a-duet', kinds: ['donkey', 'turkey'], title: 'A duet', lines: [
      'Every time Norman brays, Gus gobbles straight back.',
      'Norman brays again, just to check.',
      'It turns into a song of sorts, and neither will stop first.'] },
    { id: 'room-for-one-more', kinds: ['sheep', 'duck'], title: 'Room for one more', lines: [
      'Pip settles down in the shade next to Mabel.',
      'Mabel shuffles over so that he fits.'] },
    { id: 'a-slow-ride', kinds: ['hen', 'donkey'], title: 'A slow ride', lines: [
      "Hazel spends the afternoon perched on Norman's back.",
      "Norman walks extra slowly so she doesn't slip."] },
    { id: 'a-second-look', kinds: ['sheep', 'turkey'], title: 'A second look', lines: [
      'Gus fans out his tail, and Mabel jumps back in alarm.',
      'Gus folds it away and steps aside.',
      'Mabel creeps back for a closer look, so he fans it out again, very slowly.'] },
    { id: 'one-good-turn', kinds: ['cow', 'donkey'], title: 'One good turn', lines: [
      'Maud rubs her neck on the fence, just missing the itch.',
      'Norman ambles over and nibbles the spot for her.',
      'Then she does the same for him.'] },
    { id: 'the-race', kinds: ['pig', 'turkey'], title: 'The race', lines: [
      'Rosie and Gus set off for the far fence at the same moment.',
      'Neither will admit it is a race.',
      'They arrive together, out of breath, and pretend they meant to.'] },
  ];

  root.PADDOCK_MOMENTS = MOMENTS;
  if (typeof module !== 'undefined' && module.exports) module.exports = MOMENTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
