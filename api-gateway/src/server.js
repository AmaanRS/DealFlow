import mongoose from 'mongoose'
import { app } from './app.js'
import { config } from './config.js'
import { seedAuthenticationData } from './seed.js'

await mongoose.connect(config.mongodbUri)
console.info('Connected to MongoDB')

await seedAuthenticationData()

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`DealFlow auth API listening on port ${config.port}`)
})

async function shutdown(signal) {
  console.info(`Received ${signal}; shutting down`)
  server.close(async () => {
    await mongoose.disconnect()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
