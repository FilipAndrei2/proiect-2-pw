console.log("P3");
console.log("200 200"); // Width, height
console.log("255");

for (let i = 0; i < 200; i++) {
  for (let j = 0; j < 200; j++) {
    console.log(`${i + 56} ${j + 56} ${(i + j)}`);
  }
}
