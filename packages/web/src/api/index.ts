/**
 * The frontend's only route to the backend.
 *
 * Components and stores import from here; nothing in the application issues a
 * `fetch` of its own. That is what keeps the base URL, the credential mode, the
 * CSRF header and the error model in exactly one place.
 */
export { http, onUnauthorized } from './client';
export { ApiError, NetworkError, AbortError } from './errors';

export { adminApi } from './admin';
export { announcementsApi } from './announcements';
export { animeApi } from './anime';
export { blogApi } from './blog';
export { authApi } from './auth';
export { catalogueApi, type EditableEpisode } from './catalogue';
export { contactApi } from './contact';
export { devicesApi } from './devices';
export { discoveryApi } from './discovery';
export { engagementApi } from './engagement';
export { episodeReportsApi } from './episode-reports';
export { episodesApi } from './episodes';
export { libraryApi } from './library';
export { mediaApi } from './media';
export { notificationsApi } from './notifications';
export { pagesApi } from './pages';
export { profilesApi } from './profiles';
export { reportsApi } from './reports';
export { supportApi } from './support';
export { translatorsApi, type MyTranslatorGroup } from './translators';
