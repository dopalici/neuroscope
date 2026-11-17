/**
 * Deep reading for every state: what the ratio is, what is physically going on
 * in the head to produce it, and what it cannot tell you.
 *
 * Section-level text covers the measure itself (shared by all its states);
 * state-level text covers what this particular ratio means. Both are written to
 * be honest about a four-electrode dry headband.
 */
import { BAND_REFERENCE } from './brainState'
import type { SectionId } from './brainState'
import { BAND_ORDER } from '../types'
import type { FrameMessage } from '../types'

export interface SectionDossier {
  measure: string
  formula: string
  /** How this signal is generated in the brain / body. */
  background: string[]
  caveat: string
}

export interface StateDossier {
  headline: string
  body: string[]
}

export const SECTION_DOSSIERS: Record<SectionId, SectionDossier> = {
  signal: {
    measure: 'Per-electrode signal amplitude',
    formula:
      'standard deviation of each pad’s voltage, in microvolts, over the last window',
    background: [
      'Scalp EEG is not neurons firing. What reaches the electrode is the summed postsynaptic potential of large populations of cortical pyramidal neurons, which are aligned perpendicular to the cortical surface and therefore add up instead of cancelling out. Tens of thousands of neurons have to be doing roughly the same thing at the same time before anything survives the trip through cerebrospinal fluid, skull and scalp — which is why the result is measured in microvolts, a millionth of a volt.',
      'That tiny signal only arrives if there is a low-impedance path from skin to metal. Muse uses dry electrodes, so the path improves over the first minute as skin oils and moisture bridge the gap. A well-seated pad on a resting person lands in the tens of microvolts. A pad barely touching skin becomes a floating antenna instead: it picks up mains hum and cable movement, and its amplitude either explodes or collapses toward zero.',
    ],
    caveat:
      'This is an amplitude heuristic, not a true impedance measurement. It cannot distinguish “good cortical signal” from “consistent artifact of the right size” — it only tells you the pad is behaving plausibly.',
  },

  bands: {
    measure: 'Band power share against a typical resting spectrum',
    formula:
      'Welch power spectral density per band ÷ total power, then ÷ that band’s share in a typical 1/f profile',
    background: [
      'Cortical rhythms come from loops, not from single cells. Fast-spiking inhibitory interneurons release GABA in rhythmic volleys that silence excitatory populations for a few milliseconds at a time; the population escapes, fires, and is silenced again. Thalamocortical circuits do the same thing on a longer timescale, with the thalamus acting as a pacemaker that entrains large sheets of cortex. The frequency of a rhythm is set by the time constants of the circuit producing it, which is why bands are meaningful rather than arbitrary.',
      'Layered underneath every rhythm is aperiodic 1/f activity — broadband background whose power falls steadily as frequency rises, reflecting the balance of excitation and inhibition rather than any oscillation. Because of that slope, raw delta power almost always exceeds raw gamma power, in every brain, awake or asleep. Comparing each band against its expected share instead of against the others is what makes a genuine rhythm change visible.',
    ],
    caveat:
      'Band power mixes true oscillations with the 1/f background, so a rise can mean a stronger rhythm or just a steeper aperiodic slope. Absolute microvolt² values are not comparable between people or even between sessions.',
  },

  focus: {
    measure: 'Beta / alpha ratio, with relative alpha as its counterweight',
    formula: 'β (13–30 Hz) ÷ α (8–13 Hz) averaged across pads; calm = α ÷ total power',
    background: [
      'Alpha is not an “idle” rhythm in the sense of doing nothing — it is active inhibition with a clock. Each alpha cycle delivers a pulse of inhibition, so a cortical area running strong alpha is being gated: information can pass only in the troughs. This is why alpha rises over regions the brain is currently trying to ignore, and why it is strongest with eyes closed, when visual cortex has nothing it needs to admit.',
      'When an area is recruited for a task, that gating is released. The alpha rhythm desynchronises — populations stop marching in step — and power in the alpha band drops while faster, less synchronised beta activity rises. This is classically called alpha blocking or event-related desynchronisation. A beta/alpha ratio is a crude single number for that trade: it climbs when cortex stops gating and starts processing.',
    ],
    caveat:
      'This ratio is a popular heuristic, not a measure of attention. It cannot tell you what you are focusing on, cannot be compared between people, and rises just as happily from forehead and jaw muscle tension as from cognitive engagement.',
  },

  artifacts: {
    measure: 'Blink amplitude and jaw EMG burst amplitude',
    formula:
      '0.5–6 Hz peak amplitude on AF7/AF8 (blink) and 20–44 Hz RMS amplitude on TP9/TP10 (jaw), against fixed µV thresholds',
    background: [
      'The eye is a standing electrical dipole: the cornea sits positive relative to the retina. Rotating that dipole, or sweeping the eyelid across it, shifts the potential field across the whole front of the head. A blink therefore produces a large, slow deflection at frontal electrodes — hundreds of microvolts, one to two orders of magnitude bigger than any cortical rhythm. AF7 and AF8 sit directly above the eyes, so Muse sees this extremely clearly.',
      'Muscle is different. A clenched jaw recruits motor units in the masseter and temporalis, each firing action potentials that summate into broadband electromyographic noise stretching from about 20 Hz well past 200 Hz. TP9 and TP10 sit behind the ears, right over that muscle. Because this EMG overlaps the beta and gamma bands, an unnoticed clench can masquerade as “high beta” or “gamma activity” anywhere else in the dashboard.',
    ],
    caveat:
      'These are fixed threshold rules, not classifiers. Head movement, speech, and a shifting headband all trip them, and a genuine blink can be missed if the pads are loose.',
  },

  heart: {
    measure: 'PPG-derived heart rate and short-window HRV, read alongside head motion',
    formula:
      'bpm from 0.5–4.0 Hz bandpassed optical pulse peaks; RMSSD across consecutive valid beat intervals; motion = σ(||acc||) in milli-g',
    background: [
      'Photoplethysmography shines light into the skin and measures how much comes back. Each heartbeat pushes a pressure wave through the arterioles, blood volume in the illuminated tissue rises, absorption rises, and reflected light dips. Counting those dips gives heart rate. The sinoatrial node sets the underlying pace, but its rate is continuously pushed around by the autonomic nervous system — sympathetic drive accelerating it, vagal (parasympathetic) drive slowing it.',
      'The variability between consecutive beats is dominated by that vagal traffic, largely through respiratory sinus arrhythmia: heart rate rises slightly on inhalation and falls on exhalation as vagal outflow is gated by breathing. RMSSD captures exactly this beat-to-beat jitter, which is why it is read as an index of parasympathetic tone rather than of fitness. Motion matters here because it corrupts both signals at once — it shifts the optical sensor against the skin and drags the EEG electrodes.',
    ],
    caveat:
      'Forehead PPG through a moving headband is far noisier than a chest strap and is not an ECG. A short HRV window is a rough estimate, and any motion at all should make you distrust the number.',
  },

  nf: {
    measure: 'Relative alpha, used as a neurofeedback target',
    formula: 'α power ÷ total band power, rescaled so the bloom spans a usable range',
    background: [
      'Neurofeedback is operant conditioning applied to a brain rhythm. A feature of your own EEG is extracted in near real time and mapped to something you can perceive; because the feedback is contingent on the feature, you can gradually learn to shift it without ever being able to describe how. Alpha up-training is the oldest version of this, going back to the 1960s, and remains the easiest to demonstrate because alpha responds so strongly to eye closure and relaxed, non-effortful attention.',
      'What you are practising is releasing the gating described in section 03 — letting cortex idle rather than driving it. Effortfully trying to raise the bloom usually backfires: striving recruits cortex, desynchronises alpha and shrinks the signal you are chasing. Genuine protocols add an individual baseline, a fixed reward threshold, artifact rejection, and many sessions before any claim is made.',
    ],
    caveat:
      'This is an educational demonstration loop with no individualized baseline, no reward schedule, and no automated artifact rejection. It illustrates the closed-loop principle; it is not therapy and should not be read as training any clinical outcome.',
  },
}

export const STATE_DOSSIERS: Record<string, StateDossier> = {
  neutral: {
    headline: 'No signal to interpret yet',
    body: [
      'Nothing is being read from the headband, so there is no ratio to describe. This state exists deliberately: rather than showing a confident-looking word derived from empty buffers, the interface stays neutral until real samples arrive.',
    ],
  },

  /* —— 01 Signal —— */
  clear: {
    headline: 'All four pads are sitting in a plausible cortical range',
    body: [
      'Every electrode is producing amplitudes in the tens of microvolts — large enough that a real biological signal is reaching the amplifier, small enough that the pad is not floating or railing. The skin-electrode interface has settled: sweat and sebum have bridged the dry contact, impedance has dropped, and the amplifier is seeing cortex rather than the room.',
      'This is the only state in which the other five sections deserve much trust. Band powers, ratios and indices are all computed from these same voltages, so a clean contact is upstream of everything else the dashboard claims.',
    ],
  },
  seated: {
    headline: 'Good contact overall, with one pad still noisy',
    body: [
      'Most electrodes are in range while at least one is running hot or cold. Behind the ears this usually means hair is caught under the pad; on the forehead it usually means the band is riding too high or the skin is still dry.',
      'Averaged measures like band power will survive this, because they pool across pads. Anything that compares left against right — frontal alpha asymmetry in particular — will not, since it depends on the two frontal pads being equally trustworthy.',
    ],
  },
  settling: {
    headline: 'The skin-electrode interface has not stabilised',
    body: [
      'Dry electrodes do not reach working impedance instantly. For the first thirty to ninety seconds a thin conductive layer of moisture and skin oil is still forming, and until it does the contact behaves partly capacitively: slow drifts, wandering baselines, and amplitudes that change as you sit still.',
      'The usual fix is patience rather than adjustment. Constantly repositioning the band restarts the process; leaving it alone for a minute normally resolves it.',
    ],
  },
  drifting: {
    headline: 'One or more electrodes are effectively disconnected',
    body: [
      'A pad that has lost skin contact stops being a sensor and becomes an antenna. With a high-impedance input and nothing to reference against, it picks up mains hum, static from clothing, and every cable movement, so its amplitude either explodes or flatlines near zero as the input shorts.',
      'Nothing downstream is meaningful in this state. Band powers, focus and calm are all computed from these voltages, so a floating electrode produces confident-looking numbers about the room rather than about you.',
    ],
  },

  /* —— 02 Bands —— */
  deep: {
    headline: 'Delta is running above its usual share of the spectrum',
    body: [
      'Delta is the signature of large, slow, highly synchronous cortical activity — populations drifting together between depolarised and hyperpolarised states rather than doing anything finely differentiated. In deep non-REM sleep this is the dominant rhythm, and it is also prominent in genuine drowsiness.',
      'In an awake person sitting upright, elevated delta is more often mechanical than neural. Slow electrode drift, sweat, head movement and even breathing all deposit energy in the 1–4 Hz range, and none of it is cortical. Check the contact panel and the motion reading before believing this one.',
    ],
  },
  drift: {
    headline: 'Theta is leading — inward, drowsy, or effortful',
    body: [
      'Theta sits between sleep and concentration, which makes it genuinely ambiguous. Rising theta accompanies the descent into drowsiness, and also appears as frontal midline theta during sustained mental effort and working-memory load, generated in and around anterior cingulate cortex. Hippocampal theta coordinates memory encoding, though a scalp headband cannot see it directly.',
      'On this montage, treat theta as a signal that attention has turned inward — either toward sleep or toward something being held in mind — and use the rest of the dashboard to decide which. Heart rate and motion usually settle the question.',
    ],
  },
  open: {
    headline: 'Alpha is above its expected share — cortex is gating rather than driving',
    body: [
      'Alpha is the clearest rhythm in human EEG and reflects rhythmic inhibition rather than inactivity. A thalamocortical loop paces sheets of cortex at roughly ten cycles per second, and each cycle delivers a pulse of inhibition, so an area running strong alpha is holding itself in a standby state where information passes only in the troughs. Closing the eyes reliably drives it up.',
      'Worth knowing about this specific headband: alpha is generated most strongly over occipital and parietal cortex, and Muse has no electrode there. What reaches TP9, AF7, AF8 and TP10 is the attenuated edge of that field, so a genuine alpha rise looks smaller here than it would on a research cap.',
    ],
  },
  sharp: {
    headline: 'Beta dominates — desynchronised, actively engaged activity',
    body: [
      'Beta appears when cortical populations stop marching in step. Instead of a large synchronous rhythm you get faster, lower-amplitude, less coordinated activity, which is what active local processing looks like from outside the skull. Sensorimotor cortex also carries a characteristic beta rhythm that drops sharply just before and during movement.',
      'There is a persistent confound here. Frontalis and temporalis muscle activity spills straight into the beta range, and both sit under this headband. Genuine cognitive beta and a mildly tense forehead are hard to separate on four dry electrodes, so cross-check the jaw detector in section 04.',
    ],
  },
  bright: {
    headline: 'Energy above 30 Hz is unusually high — treat with suspicion',
    body: [
      'True cortical gamma comes from fast local circuits, particularly networks of parvalbumin-expressing interneurons whose short inhibitory time constants can pace excitatory populations at thirty to eighty cycles per second. It has been tied to feature binding and local computation, and it is real — but it is small, local, and hard to see through the skull.',
      'On a consumer scalp headband, most of what appears in this band is not cortical. Muscle EMG dominates it, mains harmonics contribute, and the 1/f background is at its weakest here so the signal-to-noise ratio is worst. Relax your jaw and watch whether this state disappears; if it does, it was your temporalis.',
    ],
  },

  /* —— 03 Focus —— */
  adrift: {
    headline: 'Neither engagement nor rest is clearly expressed',
    body: [
      'Both sides of the ratio are running low, so there is no meaningful tilt to report. This usually means the spectrum is being dominated by something that is not a rhythm at all — drift, movement, or a poor contact — rather than that your brain is in some third state.',
      'The honest reading is “not enough structure to interpret”. Fix the contact first; a genuine focus/calm balance needs a clean spectrum underneath it.',
    ],
  },
  soft: {
    headline: 'Alpha-rich: cortex is gating more than it is processing',
    body: [
      'Relative alpha is high while beta stays modest. The inhibitory alpha clock is running strongly, holding cortical areas in standby, and faster desynchronised activity has not taken over. Subjectively this is the state of unhurried, non-effortful attention — eyes closed or gaze softened, nothing being chased.',
      'This is the direction the neurofeedback bloom in section 06 rewards. Note that it is a statement about cortical gating, not about mood: alpha-rich does not mean happy, and it does not mean asleep.',
    ],
  },
  even: {
    headline: 'Gating and processing are roughly in balance',
    body: [
      'Neither alpha nor beta has clear ownership of the spectrum. Ordinary quiet wakefulness with eyes open looks like this: some areas gating, others engaged, nothing extreme in either direction.',
      'Because the ratio sits near its midpoint here, small changes will flip the word between neighbouring states. That flicker is a property of thresholding a continuous number, not evidence that your brain is oscillating between modes.',
    ],
  },
  engaged: {
    headline: 'Alpha is being suppressed relative to beta — gating released',
    body: [
      'This is alpha blocking, the most reliably reproducible effect in human EEG. When cortex is recruited, the alpha rhythm desynchronises: its populations lose phase alignment, band power drops, and faster beta activity rises in its place. Opening the eyes does it, mental arithmetic does it, and so does any genuine task demand.',
      'What the ratio cannot tell you is the content. A rising beta/alpha ratio means cortex has stopped idling; it says nothing about whether you are solving a problem, arguing in your head, or braced against a noise in the room.',
    ],
  },
  charged: {
    headline: 'Beta is running well ahead of alpha',
    body: [
      'The gating rhythm has largely given way to fast desynchronised activity. Read cautiously, this is high cortical arousal — the state of being wound up rather than merely engaged. Sympathetic arousal, effort and stress all push in this direction, and so does simple caffeine.',
      'Read sceptically, this is also exactly what a tense forehead or clenched jaw produces, because EMG lands squarely in the beta band and both muscles sit under this headband. Before accepting the interpretation, unclench your jaw, drop your shoulders, and see whether the state survives.',
    ],
  },

  /* —— 04 Body —— */
  still: {
    headline: 'No ocular or muscular events crossing threshold',
    body: [
      'Neither the frontal blink detector nor the temporal EMG detector is tripping. The face and jaw are quiet, which is the condition under which the cortical measures elsewhere are least contaminated.',
      'Absence of detections is not proof of a clean signal — sub-threshold muscle tone still contributes to beta and gamma without ever tripping a detector. It just means nothing large enough to be obvious is happening.',
    ],
  },
  blink: {
    headline: 'A blink is passing through the frontal electrodes',
    body: [
      'The eye is a standing dipole with the cornea positive relative to the retina. Sweeping the eyelid across it, and rotating the globe slightly as you blink, shifts the potential field across the front of the head. AF7 and AF8 sit directly above the eyes, so they register a large slow deflection — commonly hundreds of microvolts, far larger than any cortical rhythm.',
      'This is why blinks are the classic EEG artifact rather than a brain signal, and why research pipelines spend real effort removing them. Here they are shown deliberately: seeing how enormous a blink is next to genuine cortical activity is the fastest way to calibrate your scepticism about consumer EEG.',
    ],
  },
  clench: {
    headline: 'Jaw muscle EMG is swamping the temporal electrodes',
    body: [
      'Clenching recruits motor units in the masseter and temporalis. Each fires action potentials that summate into broadband electromyographic activity extending from roughly 20 Hz to well beyond 200 Hz, and TP9 and TP10 sit directly over that muscle. The result is a burst far larger than the cortical signal underneath it.',
      'The important consequence is upstream contamination. Because this EMG overlaps beta and gamma, an unnoticed clench inflates band powers in section 02 and pushes the focus ratio in section 03 toward “charged”. If several panels suddenly look dramatic at once, check your jaw before crediting your brain.',
    ],
  },
  restless: {
    headline: 'Body artifacts are arriving frequently',
    body: [
      'Blink and clench events are tripping often enough that a large share of the recent signal contains non-cortical energy. Frequent blinking accompanies dry eyes, screen work and tiredness; frequent jaw activity accompanies talking, chewing and simple tension.',
      'In this state the spectral panels should be read loosely at best. Any comparison across time is unsafe, since the artifact rate is changing as fast as anything neural.',
    ],
  },

  /* —— 05 Heart —— */
  listening: {
    headline: 'No pulse peaks detected yet',
    body: [
      'The PPG stream is not yielding usable beats. On real hardware this normally means the optical sensor is not pressed evenly against the forehead, or that muselsl was started without the --ppg flag so no photoplethysmography data is being published at all.',
      'Rather than display a plausible-looking resting heart rate derived from nothing, this state reports the absence directly.',
    ],
  },
  settled: {
    headline: 'Low resting rate with the head still',
    body: [
      'Heart rate is at the low end while the accelerometer reports no meaningful movement. The sinoatrial node has an intrinsic rate well above this; a low resting rate reflects vagal brake applied on top of it, parasympathetic outflow slowing the pacemaker between beats.',
      'This is the physiological context in which EEG measures are cleanest, since a still head means neither the optical sensor nor the electrodes are being dragged across skin.',
    ],
  },
  steady: {
    headline: 'Ordinary resting rate, head still',
    body: [
      'Rate and variability are both in unremarkable resting territory with no motion to corrupt them. Sympathetic and parasympathetic influences on the sinoatrial node are in their usual balance, and the beat-to-beat jitter picked up by RMSSD largely reflects respiratory sinus arrhythmia — heart rate rising slightly on each inhalation and falling on each exhalation.',
      'This is a useful baseline to remember, because it is the number that later readings are worth comparing against. Comparing your resting rate to someone else’s tells you very little.',
    ],
  },
  stirring: {
    headline: 'The head is moving — distrust everything simultaneously',
    body: [
      'The IMU is reporting motion above the still threshold. This matters more than it first appears, because movement corrupts both sensor streams at once: it shifts the optical sensor against the skin, injecting false pulse peaks, and it drags the electrodes, injecting low-frequency energy that lands in the delta band.',
      'Motion is shown next to heart rate precisely so it can be used as a veto. A dramatic EEG reading that coincides with movement is usually about the movement.',
    ],
  },
  racing: {
    headline: 'Elevated rate despite the head being still',
    body: [
      'Heart rate is high while the accelerometer reports stillness, so motion is not the explanation. Sympathetic drive raising the sinoatrial rate is the usual physiological account — arousal, stress, caffeine, recent exertion still unwinding, or simply being unwell.',
      'Treat this as a prompt to look rather than a finding. Forehead PPG through a moving headband misidentifies peaks readily, so confirm against a finger on your wrist before taking the number at face value.',
    ],
  },

  /* —— 06 Feedback —— */
  quiet: {
    headline: 'Relative alpha is low — little to reward yet',
    body: [
      'Alpha occupies a small share of the spectrum, so the bloom stays small. Eyes open, engaged with a screen, is the ordinary reason: visual cortex has information it needs to admit, so the inhibitory alpha gate is largely released.',
      'The usual way in is to stop trying. Softening the gaze or closing the eyes for a few seconds lifts alpha far more reliably than concentrating on lifting it, because effort itself desynchronises the rhythm you are aiming for.',
    ],
  },
  easing: {
    headline: 'Alpha is beginning to lift',
    body: [
      'Relative alpha has risen off the floor. Cortical areas are starting to re-establish rhythmic inhibition rather than staying fully engaged — the early part of the shift that eye closure and unhurried attention produce.',
      'This is the range where the loop starts being learnable. The feedback is now responsive enough that you can notice which internal adjustments move it, which is the entire mechanism behind neurofeedback.',
    ],
  },
  opening: {
    headline: 'Alpha is holding at a healthy share',
    body: [
      'Relative alpha is sustained rather than flickering, so the bloom is both large and stable. Holding a rhythm steady is a different skill from briefly evoking it, and it is the more useful one: real protocols reward duration above the threshold rather than peaks.',
      'Breathing tends to be what maintains it. An unforced, slightly slower exhale supports the state without recruiting the effortful attention that would break it.',
    ],
  },
  blooming: {
    headline: 'Strong, sustained relative alpha',
    body: [
      'Alpha dominates the spectrum to an unusual degree and the bloom is near full size. On this montage that most often accompanies closed eyes and genuinely unhurried attention, with the inhibitory alpha clock running strongly across the areas these electrodes can see.',
      'One honest alternative reading: drifting toward sleep also raises slow-band power, and the boundary between deep relaxation and early drowsiness is not sharp in EEG. If theta is climbing in section 02 as well, you are probably heading for a nap rather than a peak state.',
    ],
  },
}

export interface Reading {
  label: string
  value: string
}

/** The numbers behind the state, captured at the moment the panel was opened. */
export function readingFor(section: SectionId, frame: FrameMessage | null): Reading[] {
  if (!frame) return []

  switch (section) {
    case 'signal':
      return Object.entries(frame.quality).map(([pad, q]) => ({
        label: pad,
        value: `${q.uv} µV · ${q.label}`,
      }))

    case 'bands': {
      let total = 0
      for (const band of BAND_ORDER) total += frame.bands_avg[band] ?? 0
      if (total <= 0) return []
      return BAND_ORDER.map((band) => {
        const share = (frame.bands_avg[band] ?? 0) / total
        return {
          label: band,
          value: `${(share * 100).toFixed(0)}% of power · ×${(share / BAND_REFERENCE[band]).toFixed(2)} of typical`,
        }
      })
    }

    case 'focus':
      return [
        { label: 'β / α', value: frame.indices.focus.toFixed(2) },
        {
          label: 'α share',
          value: `${(frame.indices.calm * 100).toFixed(0)}% of spectrum`,
        },
        {
          label: 'FAA',
          value: `${frame.indices.faa >= 0 ? '+' : ''}${frame.indices.faa.toFixed(3)} (ln α right − left)`,
        },
      ]

    case 'artifacts':
      return [
        {
          label: 'Blink',
          value: `${frame.artifacts.blink_mag.toFixed(0)} µV of ${frame.artifacts.blink_threshold} · ${frame.artifacts.blink_rate}/min`,
        },
        {
          label: 'Jaw EMG',
          value: `${frame.artifacts.jaw_mag.toFixed(0)} µV of ${frame.artifacts.jaw_threshold} · ${frame.artifacts.jaw_rate}/min`,
        },
      ]

    case 'heart':
      return [
        {
          label: 'Rate',
          value: frame.heart.hr > 0 ? `${frame.heart.hr.toFixed(0)} bpm` : 'no beats',
        },
        {
          label: 'HRV',
          value: frame.heart.hrv > 0 ? `${frame.heart.hrv.toFixed(0)} ms RMSSD` : '—',
        },
        {
          label: 'Motion',
          value: `${frame.motion.motion.toFixed(0)} mG σ · tilt ${frame.motion.posture.toFixed(0)}° · ${frame.motion.still ? 'still' : 'moving'}`,
        },
      ]

    case 'nf':
      return [
        {
          label: 'α share',
          value: `${(frame.indices.calm * 100).toFixed(0)}% of spectrum`,
        },
        { label: 'α power', value: `${frame.indices.alpha_abs.toFixed(1)} µV²` },
      ]
  }
}
