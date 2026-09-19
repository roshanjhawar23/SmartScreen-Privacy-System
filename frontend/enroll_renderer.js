const video = document.getElementById('camera');
const canvas = document.getElementById('captureCanvas');
const startButton = document.getElementById('startButton');
const captureButton = document.getElementById('captureButton');
const finishButton = document.getElementById('finishButton');
const cancelButton = document.getElementById('cancelButton');
const instruction = document.getElementById('instruction');
const progress = document.getElementById('progress');
const message = document.getElementById('message');

let stream = null;
const samples = [];

const instructions = [
  'Face the camera naturally.',
  'Turn your head slightly to the left.',
  'Turn your head slightly to the right.',
  'Raise your chin slightly and stay centered.',
  'Return to a natural forward position.'
];

function setMessage(text = '', ok = false){
  message.textContent = text;
  message.classList.toggle('ok', ok);
}

function updateProgress(){
  progress.textContent = `${samples.length} / 5`;
  captureButton.disabled = !stream || samples.length >= 5;
  finishButton.disabled = samples.length !== 5;
  instruction.textContent = samples.length < 5 ? instructions[samples.length] : 'All samples captured. Complete enrollment.';
}

async function startCamera(){
  setMessage('');
  startButton.disabled = true;

  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},
      audio:false
    });
    video.srcObject = stream;
    document.body.classList.add('camera-ready');
    updateProgress();
  }catch(error){
    startButton.disabled = false;
    setMessage('Camera access was not available. Check Windows camera permissions and try again.');
  }
}

function captureSample(){
  if(!stream || samples.length >= 5) return;

  const width = 640;
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 480;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  samples.push(canvas.toDataURL('image/jpeg',0.86));
  setMessage(`Sample ${samples.length} captured.`, true);
  updateProgress();
}

async function finishEnrollment(){
  if(samples.length !== 5) return;

  finishButton.disabled = true;
  captureButton.disabled = true;
  setMessage('Validating biometric samples...');
  instruction.textContent = 'Processing locally on this device.';

  try{
    const result = await window.enrollmentAPI.submit(samples);
    if(!result.ok){
      setMessage(result.error || 'Enrollment could not be completed.');
      finishButton.disabled = false;
      captureButton.disabled = false;
      updateProgress();
      return;
    }

    setMessage('Enrollment complete. Starting SmartScreen.', true);
    stopCamera();
    setTimeout(()=>window.close(),500);
  }catch(error){
    console.error(error);
    setMessage('Enrollment could not be completed.');
    finishButton.disabled = false;
    updateProgress();
  }
}

function stopCamera(){
  if(stream){
    stream.getTracks().forEach(track=>track.stop());
    stream=null;
  }
  video.srcObject=null;
}

startButton.addEventListener('click',startCamera);
captureButton.addEventListener('click',captureSample);
finishButton.addEventListener('click',finishEnrollment);
cancelButton.addEventListener('click',()=>{
  stopCamera();
  window.enrollmentAPI.cancel();
});

window.addEventListener('beforeunload',stopCamera);
updateProgress();
