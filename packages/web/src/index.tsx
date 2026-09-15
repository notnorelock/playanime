/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from '~/app/App.js';
// Order matters: Tailwind first so its layers are established, then the design
// system, whose @theme extends them and whose base rules must win over
// preflight.
import '~/styles/index.css';
import '@playanime/ui/styles.scss';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Root element #root is missing from index.html.');
}

render(() => <App />, root);
