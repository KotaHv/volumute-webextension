import { AudioController, hookMediaElements, setVolume } from './audio';

const controller = new AudioController();
hookMediaElements(controller);

document.addEventListener('volumute:set-volume', (e) => {
  const v = (e as CustomEvent<{ volume?: number }>).detail?.volume;
  if (typeof v === 'number') setVolume(v);
});