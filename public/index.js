'use strict';

const createButton = document.querySelector('#create-room');
const createError = document.querySelector('#create-error');
const joinForm = document.querySelector('#join-form');
const joinError = document.querySelector('#join-error');

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  createButton.textContent = '建立中…';
  try {
    const result = await App.api('/api/rooms', { method: 'POST' });
    localStorage.setItem(`hostToken:${result.roomCode}`, result.hostToken);
    location.href = result.hostUrl;
  } catch (error) {
    App.showError(createError, error.message);
    createButton.disabled = false;
    createButton.textContent = '建立遊戲';
  }
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomCode = document.querySelector('#room-code').value.trim();
  const name = document.querySelector('#player-name').value.trim();
  const button = joinForm.querySelector('button');
  button.disabled = true;
  try {
    const result = await App.api(`/api/rooms/${roomCode}/join`, { method: 'POST', body: { name } });
    localStorage.setItem(`playerToken:${roomCode}`, result.playerToken);
    location.href = result.playUrl;
  } catch (error) {
    App.showError(joinError, error.message);
    button.disabled = false;
  }
});
