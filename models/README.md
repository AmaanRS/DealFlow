# DealFlow shared models

`@app/models` is the single source of truth for Mongoose schemas shared by the
API gateway and Night Sky services. It defines models only; each service remains
responsible for calling `mongoose.connect()` and closing its own connection.

Import the smallest domain surface needed by a service:

```js
import { User, Session } from '@app/models/auth'
import { TierDiscount } from '@app/models/discounts'
import { Article, Item } from '@app/models/catalog'
import { USER_ROLES } from '@app/models/constants'
```

Mongoose is a peer dependency so every service and the shared models resolve the
same Mongoose runtime and default model registry. Collection names are explicitly
pinned to preserve the existing DealFlow database layout.
