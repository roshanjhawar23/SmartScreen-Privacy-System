// Trusted people: one encrypted biometric template per person. Pure: no Electron imports.
// main.js injects encrypt/decrypt (Electron safeStorage) and fs; tests inject fakes.
//
// Layout: <dir>/<id>.enc = encrypt(JSON {id, name, createdAt, sampleCount, embedding}) as base64.
// Listing never returns embeddings; only templates() does, for the recognition backend.

const path = require('path');

const ID_PATTERN = /^[a-f0-9]{16}$/;
const MAX_PEOPLE = 10;

function validateName(name){
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if(!value || value.length > 40 || /[\u0000-\u001f<>]/.test(value)) throw new Error('Name must be 1–40 characters.');
  return value;
}

function validateEmbedding(embedding){
  if(!Array.isArray(embedding) || embedding.length < 32 || !embedding.every((v) => Number.isFinite(v))){
    throw new Error('Invalid biometric template.');
  }
  return embedding.map(Number);
}

function createTrustedStore({ dir, encrypt, decrypt, fs, now = () => new Date(), randomId }){
  const file = (id) => path.join(dir, `${id}.enc`);

  function readPerson(id){
    const raw = fs.readFileSync(file(id), 'utf8').trim();
    const person = JSON.parse(decrypt(Buffer.from(raw, 'base64')));
    if(person.id !== id) throw new Error('Template file does not match its id.');
    return person;
  }

  function writePerson(person){
    fs.mkdirSync(dir, { recursive:true });
    const tmp = `${file(person.id)}.tmp`;
    fs.writeFileSync(tmp, encrypt(JSON.stringify(person)).toString('base64'), 'utf8');
    fs.renameSync(tmp, file(person.id));
  }

  function ids(){
    if(!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.enc')).map((f) => f.slice(0, -4)).filter((id) => ID_PATTERN.test(id));
  }

  function all(){
    return ids().map(readPerson).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  const summary = ({ id, name, createdAt, sampleCount }) => ({ id, name, createdAt, sampleCount });

  return {
    list(){ return all().map(summary); },
    count(){ return ids().length; },
    templates(){ return all().map(({ id, embedding }) => ({ id, embedding })); },

    add({ name, embedding, sampleCount = 0 }){
      if(ids().length >= MAX_PEOPLE) throw new Error(`At most ${MAX_PEOPLE} trusted people.`);
      const person = {
        id:randomId(), name:validateName(name), createdAt:now().toISOString(),
        sampleCount:Number(sampleCount) || 0, embedding:validateEmbedding(embedding)
      };
      writePerson(person);
      return summary(person);
    },

    reenroll(id, { embedding, sampleCount = 0 }){
      if(!ID_PATTERN.test(id) || !fs.existsSync(file(id))) throw new Error('Unknown person.');
      const person = { ...readPerson(id), embedding:validateEmbedding(embedding), sampleCount:Number(sampleCount) || 0, updatedAt:now().toISOString() };
      writePerson(person);
      return summary(person);
    },

    rename(id, name){
      if(!ID_PATTERN.test(id) || !fs.existsSync(file(id))) throw new Error('Unknown person.');
      const person = { ...readPerson(id), name:validateName(name) };
      writePerson(person);
      return summary(person);
    },

    remove(id){
      if(!ID_PATTERN.test(id) || !fs.existsSync(file(id))) throw new Error('Unknown person.');
      if(ids().length <= 1) throw new Error('At least one trusted person is required.');
      fs.unlinkSync(file(id));
    },

    // One-time migration of the single-owner template (Phases 1–3). The legacy file is only
    // deleted after the new file has been written and read back with the same embedding.
    migrateLegacy(legacy){
      if(ids().length > 0 || !legacy || !Array.isArray(legacy.embedding)) return { migrated:false };
      const added = this.add({ name:'Owner', embedding:legacy.embedding, sampleCount:legacy.sampleCount || 0 });
      const back = readPerson(added.id);
      const same = back.embedding.length === legacy.embedding.length && back.embedding.every((v, i) => v === Number(legacy.embedding[i]));
      if(!same){
        fs.unlinkSync(file(added.id));
        throw new Error('Migration check failed; the original template was kept.');
      }
      return { migrated:true, person:added };
    }
  };
}

module.exports = { createTrustedStore, validateName, MAX_PEOPLE };
