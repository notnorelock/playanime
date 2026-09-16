# PlayAnime Frontend

A **professional, modern anime streaming web application** built with Vue 3, TypeScript, and Tailwind CSS v4. Features a stunning glassmorphic design inspired by Crunchyroll and Apple's Liquid UI.

## 🎨 Design Features

- **Glassmorphism**: Semi-transparent glass surfaces with blurred gradients
- **Liquid Reflections**: Smooth hover effects and depth shadows
- **Crunchyroll Orange** (#F47521) as primary color with neon accents
- **Dark Theme** optimized for viewing experience
- **Smooth Transitions**: Apple TV+ style page transitions
- **Responsive Design**: Mobile-first approach with adaptive layouts

## 🚀 Tech Stack

### Core
- **Vue 3** - Composition API with `<script setup>`
- **TypeScript** - Strict typing for all components
- **Vite** - Lightning-fast build tool
- **Pinia** - State management
- **Vue Router** - Client-side routing with lazy loading

### Styling
- **Tailwind CSS v4** - Custom theme with glassmorphism utilities
- **SCSS** - Enhanced styling capabilities
- **Inter Font** - Professional typography

### Features
- **Video.js** - Professional video player with custom anime-themed skin
- **Vue I18n** - Polish and English localization
- **Lucide Vue** - Beautiful icon library
- **Motion One** - Smooth animations
- **VueUse** - Composition utilities

## 📁 Project Structure

```
client/
├── src/
│   ├── assets/          # Static assets (images, fonts, icons)
│   ├── components/
│   │   ├── ui/          # Reusable UI components (Button, Card, etc.)
│   │   ├── layout/      # Layout components (Navbar, Footer)
│   │   ├── media/       # Media components (VideoPlayer, Thumbnail)
│   │   └── shared/      # Shared components (AnimeCard)
│   ├── composables/     # Vue composables
│   ├── data/            # Dummy JSON data
│   ├── locales/         # i18n translation files (pl.json, en.json)
│   ├── router/          # Vue Router configuration
│   ├── store/           # Pinia stores
│   ├── styles/          # Global styles (Tailwind, SCSS)
│   ├── types/           # TypeScript interfaces and types
│   ├── utils/           # Helper functions
│   ├── views/           # Page components
│   ├── App.vue          # Root component
│   └── main.ts          # Application entry point
├── public/              # Public static files
└── package.json         # Dependencies and scripts
```

## 🎯 Core Features

### 1. Home Page
- Featured anime carousel with auto-rotation
- Trending section
- Recently added anime
- Continue watching (with progress tracking)
- Top rated anime

### 2. Anime Detail Page
- Beautiful hero banner
- Comprehensive anime information
- Episode list with thumbnails
- Related anime recommendations
- Translator information

### 3. Watch Page
- Video.js player with custom anime theme
- Multiple subtitle track support (.vtt, .srt)
- Episode navigation (next/previous)
- Auto-play next episode
- Watch progress tracking (localStorage)
- Translator notes display

### 4. Browse & Search
- Search by title, genre, or translator
- Filter by status, year, rating
- Sort by various criteria
- Responsive grid layout

### 5. Translators
- Translator profiles with statistics
- Anime translated by each translator
- Social links and bios

### 6. Settings
- Theme toggle (Light/Dark/Auto)
- Language selection (Polish/English)
- Playback preferences

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Navigate to client directory
cd client

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Development

The app will be available at **http://localhost:5173/**

## 🎨 Custom Tailwind Theme

The project includes custom Tailwind CSS v4 utilities:

```css
/* Glassmorphism */
.glass-light      /* Light glass effect */
.glass-medium     /* Medium glass effect */
.glass-strong     /* Strong glass effect */

/* Glow Effects */
.glow-primary           /* Primary glow */
.glow-primary-hover     /* Primary glow on hover */

/* Gradients */
.text-gradient-primary  /* Primary text gradient */
.text-gradient-neon     /* Neon text gradient */
.gradient-animated      /* Animated background gradient */

/* Liquid Effects */
.liquid-reflection      /* Liquid reflection on hover */

/* Transitions */
.transition-smooth      /* Smooth transition */
.transition-spring      /* Spring-style transition */

/* Shadows */
.shadow-depth          /* Deep shadow for depth */
```

## 🌍 Localization

The app supports Polish (default) and English:

```typescript
// Switch language
import { useI18n } from 'vue-i18n'
const { locale } = useI18n()
locale.value = 'en' // or 'pl'
```

## 📦 State Management

### Anime Store
```typescript
import { useAnimeStore } from '@/store/anime'

const animeStore = useAnimeStore()

// Access anime data
animeStore.animeList
animeStore.trendingAnime
animeStore.recentlyAdded
animeStore.continueWatching

// Actions
animeStore.getAnimeById(id)
animeStore.searchAnime(query)
animeStore.updateWatchProgress(progress)
```

## 🎬 Video Player

The app uses **Video.js** with a custom anime-themed skin. Key features:

- Custom play button
- Glassmorphic control bar
- Multiple subtitle tracks
- Playback speed control
- Keyboard shortcuts
- Progress tracking
- Auto-play next episode

## 📱 Responsive Design

- **Mobile**: Optimized for phones (< 768px)
- **Tablet**: Adapted layout (768px - 1024px)
- **Desktop**: Full experience (> 1024px)
- **4K**: Enhanced visuals (> 1920px)

## 🎨 Color Palette

```scss
Primary Orange:    #F47521 (Crunchyroll)
Primary Hover:     #FF8C3A
Accent Blue:       #4D9FFF
Accent Purple:     #B084FF
Accent Pink:       #FF6B9D
Accent Cyan:       #4DD4FF

Dark Neutrals:
- 900: #0A0A0F
- 800: #131318
- 700: #1A1A22
- 600: #242430
- 500: #2D2D3D
```

## 🔧 TypeScript Types

All TypeScript interfaces are defined in `src/types/index.ts`:

- `Anime` - Anime information
- `Episode` - Episode data
- `Translator` - Translator profile
- `SubtitleTrack` - Subtitle information
- `WatchProgress` - Watch progress tracking
- `User` - User data

## 🚀 Performance Optimizations

- **Lazy Loading**: All routes and components lazy-loaded
- **Image Optimization**: Lazy loading with native `loading="lazy"`
- **Code Splitting**: Automatic chunk splitting by Vite
- **Tree Shaking**: Unused code eliminated
- **Cache Management**: localStorage for watch progress

## 📝 License

This is a **non-commercial, fan-based platform** created for educational purposes. All anime content and translations are property of their respective owners.

## 🤝 Contributing

This is a demo project showcasing modern Vue 3 + TypeScript development with glassmorphic design.

## 👨‍💻 Development Notes

- All components use Composition API with `<script setup>`
- Strict TypeScript typing enforced
- i18n ready for Polish and English
- Video.js integrated with custom theme
- Watch progress saved to localStorage
- Glassmorphism implemented with Tailwind utilities

## 🎉 Credits

- Design inspiration: Crunchyroll, Apple TV+, Zoro.to
- Icons: Lucide Vue
- Fonts: Inter (Google Fonts)
- Video Player: Video.js

---

**Built with ❤️ for anime fans**
