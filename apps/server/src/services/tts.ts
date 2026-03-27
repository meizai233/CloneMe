export function synthesizeSpeech(text: string) {
  const fakeAudioUrl = `/mock-audio/${Date.now()}.wav`;

  // Placeholder phoneme timeline to drive mouth movement.
  const phonemeCues = text.split("").slice(0, 30).map((_, idx) => (idx % 4) / 4);

  return {
    audioUrl: fakeAudioUrl,
    phonemeCues
  };
}
