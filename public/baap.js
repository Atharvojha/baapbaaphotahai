// The mascot. Pure SVG so every feature (brows, flush, steam, mooch) can react to Papa's mood.
// Mood is set with data-mood="calm|annoyed|furious|proud" on any ancestor; CSS does the rest.

let uid = 0;

export function baapFace({ badge = false } = {}) {
  const id = `baap-${++uid}`;
  const clip = badge ? `clip-path="url(#${id}-clip)"` : "";
  return `
<svg class="baap" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="${id}-clip"><circle cx="100" cy="100" r="100"/></clipPath>
    <radialGradient id="${id}-cheek" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="var(--sindoor)" stop-opacity=".55"/>
      <stop offset="1" stop-color="var(--sindoor)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${badge ? `<circle cx="100" cy="100" r="100" class="badge-bg"/>` : ""}
  <g ${clip}>
    <g class="steam">
      <path d="M50 74 c-6 -8 4 -12 -2 -20 c-4 -6 2 -10 0 -14"/>
      <path d="M150 74 c6 -8 -4 -12 2 -20 c4 -6 -2 -10 0 -14"/>
    </g>
    <path class="skin" d="M26 214 C28 170 56 150 86 146 L114 146 C144 150 172 170 174 214 Z"/>
    <path class="vest" d="M58 214 L61 168 C66 161 72 157 79 153 C89 171 111 171 121 153 C128 157 134 161 139 168 L142 214 Z"/>
    <path class="skin-shade" d="M86 126 L86 150 C94 158 106 158 114 150 L114 126 Z"/>
    <ellipse class="skin" cx="55" cy="98" rx="9" ry="14"/>
    <ellipse class="skin" cx="145" cy="98" rx="9" ry="14"/>
    <ellipse class="skin" cx="100" cy="92" rx="45" ry="52"/>
    <ellipse class="shine" cx="82" cy="54" rx="13" ry="6" transform="rotate(-18 82 54)"/>
    <path class="hair" d="M57 64 C48 77 48 94 54 106 C58 99 62 97 65 97 C60 86 60 74 67 65 Z"/>
    <path class="hair" d="M143 64 C152 77 152 94 146 106 C142 99 138 97 135 97 C140 86 140 74 133 65 Z"/>
    <ellipse class="flush" cx="100" cy="78" rx="42" ry="36" fill="url(#${id}-cheek)"/>
    <g class="wrinkles">
      <path d="M84 62 Q100 57 116 62"/>
      <path d="M88 69 Q100 65 112 69"/>
    </g>
    <g class="eyes">
      <circle cx="81" cy="96" r="3.6"/>
      <circle cx="119" cy="96" r="3.6"/>
    </g>
    <g class="specs">
      <rect x="66" y="86" width="30" height="20" rx="6"/>
      <rect x="104" y="86" width="30" height="20" rx="6"/>
      <path d="M96 94 Q100 90.5 104 94"/>
      <path d="M66 92 L57 90"/>
      <path d="M134 92 L143 90"/>
    </g>
    <path class="brow brow-l" d="M68 79 L92 83"/>
    <path class="brow brow-r" d="M132 79 L108 83"/>
    <path class="nose" d="M100 100 C96 108 94 114 98 117 C100 118 103 118 105 116"/>
    <path class="mouth mouth-frown" d="M90 135 Q100 129 110 135"/>
    <path class="mouth mouth-smile" d="M89 132 Q100 140 111 132"/>
    <path class="mooch" d="M100 119 C92 113 78 113 70 120 C66 124 61 126 56 124 C60 133 76 136 88 130 C94 127 97 126 100 126 C103 126 106 127 112 130 C124 136 140 133 144 124 C139 126 134 124 130 120 C122 113 108 113 100 119 Z"/>
  </g>
</svg>`;
}

// The Hawai chappal: blue rim, white sole, blue V straps. Every Indian kid knows this silhouette.
export function chappal() {
  return `
<svg class="chappal" viewBox="0 0 64 128" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="52" height="120" rx="25" class="chappal-rim"/>
  <rect x="11" y="9" width="42" height="110" rx="20" class="chappal-sole"/>
  <path d="M32 34 L15 70 M32 34 L49 70" class="chappal-strap"/>
  <circle cx="32" cy="33" r="4.5" class="chappal-post"/>
</svg>`;
}
