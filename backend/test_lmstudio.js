const axios = require("axios");

async function test() {
  try {
    const res = await axios.post("http://localhost:3001/api/chat", {
      model: "qwen3-8b",
      input: "test",
      stream: false
    });
    console.log("SUCCESS:", res.data);
  } catch(e) {
    if(e.response) {
      console.log("ERROR STATUS:", e.response.status);
      console.log("ERROR DATA:", JSON.stringify(e.response.data, null, 2));
    } else {
      console.log("ERROR FETCHING:", e.message);
    }
  }
}

test();
