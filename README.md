# Stream Mix Spectrogram

Static GitHub Pages app with two full-screen spectrograms:

- top: audible mix of `https://libretime.bauhaus.fm/_a` plus a hardcoded WAV, shown from 0-15000 Hz
- bottom: hardcoded WAV only, shown from 5000-10000 Hz

There is one visible **Start** button. After playback starts, the button disappears and only the two spectrograms remain.

## WAV file

The WAV URL is set near the top of `app.js`:

```js
const WAV_URL = "audio-file.wav";
```

Most reliable option: upload the WAV into the same GitHub repository next to `index.html` and name it `audio-file.wav`.

Google Drive can work only if the URL is a direct downloadable file URL and Google sends CORS headers that allow browser audio decoding. If it fails, use the same-repository WAV file approach or host the WAV on a static file host with CORS enabled.
