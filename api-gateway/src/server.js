import mongoose from 'mongoose'
import { app } from './app.js'
import { config } from './config.js'

const port = config.get('port')

await mongoose.connect(config.get('mongodb_uri'))
console.info('Connected to MongoDB')

const server = app.listen(port, '0.0.0.0', () => {
  console.info(`DealFlow auth API listening on port ${port}`)
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
