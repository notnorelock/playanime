# Advanced Storage System

A comprehensive localStorage management system for the frontend with type safety, encryption, expiration, and reactive Vue integration.

## Features

- **Type-Safe Storage**: Full TypeScript support with generic types
- **Reactive Integration**: Vue composables for automatic reactivity
- **Encryption**: Basic obfuscation for sensitive data
- **Expiration**: Automatic cleanup of expired entries
- **API Caching**: Built-in caching for API responses
- **Settings Management**: Persistent user settings with Pinia store
- **Size Management**: Track and manage storage size
- **Prefix Support**: Namespaced storage keys

## Table of Contents

1. [Storage Class](#storage-class)
2. [useStorage Composable](#usestorage-composable)
3. [API Cache](#api-cache)
4. [Settings Store](#settings-store)
5. [Best Practices](#best-practices)

---

## Storage Class

### Basic Usage

```typescript
import { storage } from '@/utils/storage'

// Set a value
storage.set('user_preference', { theme: 'dark', fontSize: 16 })

// Get a value
const preference = storage.get('user_preference')
console.log(preference) // { theme: 'dark', fontSize: 16 }

// Check if exists
if (storage.has('user_preference')) {
  console.log('Preference exists!')
}

// Remove a value
storage.remove('user_preference')

// Clear all storage (with prefix)
storage.clear()
```

### Creating Custom Storage

```typescript
import { createStorage } from '@/utils/storage'

const cartStorage = createStorage({
  prefix: 'cart_',                        // Key prefix
  defaultValue: [],                       // Default value if key doesn't exist
  expiresIn: 7 * 24 * 60 * 60 * 1000,    // 7 days expiration
  encrypt: false                          // Enable encryption
})

cartStorage.set('items', [{ id: 1, name: 'Product' }])
const items = cartStorage.get('items')
```

### Type-Safe Storage

```typescript
interface UserProfile {
  id: number
  username: string
  email: string
}

const profileStorage = createStorage<UserProfile>({
  prefix: 'profile_',
  defaultValue: {
    id: 0,
    username: '',
    email: ''
  }
})

// Fully typed
const profile = profileStorage.get('current') // UserProfile | undefined
```

### Storage with Expiration

```typescript
import { createStorage } from '@/utils/storage'

const tempStorage = createStorage({
  prefix: 'temp_',
  expiresIn: 60 * 60 * 1000 // 1 hour
})

// Set with default expiration (1 hour)
tempStorage.set('session_data', { userId: 123 })

// Set with custom expiration (5 minutes)
tempStorage.set('otp_code', '123456', 5 * 60 * 1000)
```

### Secure Storage (Encrypted)

```typescript
import { secureStorage } from '@/utils/storage'

// Values are encrypted in localStorage
secureStorage.set('api_key', 'secret-key-12345')
const apiKey = secureStorage.get('api_key')
```

### Storage Methods

| Method | Description |
|--------|-------------|
| `get(key)` | Get a value by key |
| `set(key, value, expiresIn?)` | Set a value with optional expiration |
| `remove(key)` | Remove a value |
| `has(key)` | Check if key exists |
| `clear()` | Clear all keys with prefix |
| `keys()` | Get all keys with prefix |
| `getAll()` | Get all values with prefix |
| `size()` | Get storage size in bytes |
| `cleanup()` | Remove expired entries |

---

## useStorage Composable

### Basic Usage

```vue
<script setup>
import { useStorage } from '@/composables/useStorage'

const { value, save, remove, reset, isLoading, error } = useStorage('cart_items', [])

// value is reactive - changes are automatically saved
value.value.push({ id: 1, name: 'Product' })
</script>
```

### Simple localStorage

```vue
<script setup>
import { useLocalStorage } from '@/composables/useStorage'

// Simple reactive localStorage with auto-save
const { value: username } = useLocalStorage('username', 'Guest')

// Changes auto-save to localStorage
username.value = 'JohnDoe'

// With debounce (500ms)
const { value: searchQuery } = useLocalStorage('search_query', '', 500)
</script>
```

### Secure Storage

```vue
<script setup>
import { useSecureStorage } from '@/composables/useStorage'

// Encrypted storage
const { value: token } = useSecureStorage('refresh_token', '')

token.value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
</script>
```

### Temporary Storage

```vue
<script setup>
import { useTemporaryStorage } from '@/composables/useStorage'

// Storage that expires after 30 minutes
const { value: otpCode } = useTemporaryStorage(
  'otp_verification',
  '',
  30 * 60 * 1000
)

otpCode.value = '123456'
</script>
```

### With Callbacks

```vue
<script setup>
import { useStorage } from '@/composables/useStorage'

const { value } = useStorage('user_data', null, {
  onLoad: (data) => {
    console.log('Data loaded:', data)
  },
  onSave: (data) => {
    console.log('Data saved:', data)
  },
  onError: (error) => {
    console.error('Storage error:', error)
  },
  debounce: 500 // Debounce saves by 500ms
})
</script>
```

### Manual Save Mode

```vue
<script setup>
import { useStorage } from '@/composables/useStorage'

// Disable auto-save
const { value, save } = useStorage('draft', '', {
  watchForChanges: false
})

value.value = 'Draft content...'

// Manually save when ready
save()
</script>
```

---

## API Cache

### Basic Usage

```typescript
import { apiCache } from '@/utils/api-cache'

async function fetchAnimeList(page: number) {
  // Check cache first
  const cached = apiCache.get('anime', 'list', [{ page }])
  if (cached) {
    return cached
  }

  // Fetch from API
  const data = await api.command('anime', 'list', { page })

  // Cache for 5 minutes
  apiCache.set('anime', 'list', data, [{ page }], 5 * 60 * 1000)

  return data
}
```

### Cache Invalidation

```typescript
import { apiCache } from '@/utils/api-cache'

// Invalidate all anime cache
apiCache.invalidateResource('anime')

// Invalidate specific command
apiCache.invalidateCommand('anime', 'list')

// Remove specific entry
apiCache.remove('anime', 'list', [{ page: 1 }])

// Clear all cache
apiCache.clear()
```

### Custom API Cache

```typescript
import { createAPICache } from '@/utils/api-cache'

const animeCache = createAPICache({
  prefix: 'anime_cache_',
  defaultTTL: 10 * 60 * 1000, // 10 minutes
  maxSize: 50                  // Maximum 50 entries
})
```

### Cache Statistics

```typescript
import { apiCache } from '@/utils/api-cache'

const stats = apiCache.stats()
console.log(stats)
// {
//   size: 1024,      // Size in bytes
//   totalSize: 100,  // Max size
//   keys: 5          // Number of cached entries
// }

// Cleanup expired entries
apiCache.cleanup()
```

### Cache Decorator (Advanced)

```typescript
import { cached } from '@/utils/api-cache'

class AnimeService {
  @cached(5 * 60 * 1000) // Cache for 5 minutes
  async getAnimeList(page: number) {
    return await api.command('anime', 'list', { page })
  }
}
```

---

## Settings Store

### Usage in Components

```vue
<script setup>
import { useSettingsStore } from '@/store/settings'

const settingsStore = useSettingsStore()

// Access settings
console.log(settingsStore.settings.language) // 'en'
console.log(settingsStore.settings.theme)    // 'dark'

// Update a single setting
settingsStore.updateSetting('language', 'pl')

// Update multiple settings
settingsStore.updateSettings({
  language: 'en',
  autoplay: false,
  notifications: true
})

// Reset to defaults
settingsStore.reset()
</script>

<template>
  <div>
    <p>Language: {{ settingsStore.settings.language }}</p>
    <p>Theme: {{ settingsStore.settings.theme }}</p>
  </div>
</template>
```

### Available Settings

```typescript
interface UserSettings {
  language: 'en' | 'pl'                              // UI language
  theme: 'light' | 'dark' | 'auto'                   // Theme mode
  autoplay: boolean                                   // Autoplay next episode
  subtitleSize: 'small' | 'medium' | 'large'         // Subtitle size
  videoQuality: 'auto' | '360p' | '480p' | '720p' | '1080p'  // Video quality
  notifications: boolean                              // Enable notifications
}
```

### Settings Persistence

Settings are automatically:
- Saved to localStorage on change
- Loaded on app initialization
- Synced with i18n (language)
- Available across all components

---

## Best Practices

### 1. Use Appropriate Storage Type

```typescript
// ✅ Good: Use secure storage for sensitive data
const { value: apiKey } = useSecureStorage('api_key', '')

// ❌ Bad: Don't store sensitive data in plain storage
const { value: apiKey } = useLocalStorage('api_key', '')
```

### 2. Set Appropriate Expiration

```typescript
// ✅ Good: Set expiration for temporary data
const otpStorage = createStorage({
  prefix: 'otp_',
  expiresIn: 5 * 60 * 1000 // 5 minutes
})

// ❌ Bad: No expiration for temporary data
const otpStorage = createStorage({ prefix: 'otp_' })
```

### 3. Use Settings Store for User Preferences

```typescript
// ✅ Good: Use settings store for user preferences
const settingsStore = useSettingsStore()
settingsStore.updateSetting('language', 'pl')

// ❌ Bad: Don't create separate storage for settings
const { value } = useLocalStorage('language', 'en')
```

### 4. Cache API Responses

```typescript
// ✅ Good: Cache API responses
const cached = apiCache.get('anime', 'list', [{ page }])
if (cached) return cached

// ❌ Bad: Fetch every time without caching
const data = await api.command('anime', 'list', { page })
```

### 5. Use Debouncing for Frequent Updates

```typescript
// ✅ Good: Debounce frequent updates
const { value } = useLocalStorage('search_query', '', 500)

// ❌ Bad: Save on every keystroke
const { value } = useLocalStorage('search_query', '', 0)
```

### 6. Clean Up Expired Data

```typescript
// ✅ Good: Periodically cleanup expired data
setInterval(() => {
  storage.cleanup()
  apiCache.cleanup()
}, 60 * 60 * 1000) // Every hour

// ❌ Bad: Never cleanup, wasting storage space
```

### 7. Handle Storage Errors

```typescript
// ✅ Good: Handle errors gracefully
const { value, error } = useStorage('data', null, {
  onError: (err) => {
    console.error('Storage error:', err)
    // Show user-friendly message
  }
})

// ❌ Bad: Ignore errors
const { value } = useStorage('data', null)
```

### 8. Use Type-Safe Storage

```typescript
// ✅ Good: Type-safe storage
interface Cart {
  items: Array<{ id: number; name: string }>
}
const cartStorage = createStorage<Cart>({ prefix: 'cart_' })

// ❌ Bad: Untyped storage
const cartStorage = createStorage({ prefix: 'cart_' })
```

---

## File Structure

```
client/src/
├── utils/
│   ├── storage.ts              # Storage class
│   ├── api-cache.ts            # API cache utility
│   ├── storage.example.ts      # Usage examples
│   └── STORAGE_README.md       # This file
├── composables/
│   └── useStorage.ts           # Storage composable
└── store/
    └── settings.ts             # Settings store
```

---

## Migration Guide

### From Direct localStorage

```typescript
// Before
localStorage.setItem('user', JSON.stringify({ name: 'John' }))
const user = JSON.parse(localStorage.getItem('user'))

// After
storage.set('user', { name: 'John' })
const user = storage.get('user')
```

### From Direct localStorage in Vue

```vue
<!-- Before -->
<script setup>
const username = ref(localStorage.getItem('username') || '')
watch(username, (value) => {
  localStorage.setItem('username', value)
})
</script>

<!-- After -->
<script setup>
import { useLocalStorage } from '@/composables/useStorage'
const { value: username } = useLocalStorage('username', '')
</script>
```

---

## Performance Tips

1. **Use prefixes** to organize storage and avoid key collisions
2. **Set expiration** for temporary data to save space
3. **Use debouncing** for frequently updated values
4. **Cache API responses** to reduce network requests
5. **Clean up regularly** to remove expired entries
6. **Monitor storage size** with `storage.size()`

---

## Browser Support

- Chrome 4+
- Firefox 3.5+
- Safari 4+
- Edge (all versions)
- IE 8+

---

## License

Part of the PlayAnime project.
