const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(
  "sk_test_51PLQUL0766TmHmC2y5WbAWXAaiPLyjgaD6f77mqiradovZqSjU0CCcAOhkMjCkAh38HoiY4Wr28HsJ4tg4eVY14700dcA3HTzy"
);
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

// middleware 
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xrbh57q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("BistroDb").collection('users');
    const menuCollection = client.db("BistroDb").collection('menu');
    const reviewCollection = client.db("BistroDb").collection('reviews');
    const cartCollection = client.db("BistroDb").collection('carts');
    const paymentCollection = client.db("BistroDb").collection('payments');


    app.post('/jwt', async( req, res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN,{expiresIn : '1h'})
      res.send({token})
    })

    // middleware
    const verifyToken = (req, res, next) => {
      // console.log('test verify token',req.headers);
      if (!req.headers.authorization){
        return res.status(401).send({ message: "unauthorized access" });
      } 
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if(err){
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next()
      })
    }

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = {email : email};
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      } 
      next()
    }

    app.get('/user/admin/:email',verifyToken,async(req, res)=>{
      const email = req.params.email;
      if(email !== req.decoded.email){
        return req.status(401).send({message : "unauthorized access"})
      }
      const query = {email : email};
      const user = await usersCollection.findOne(query);
      let admin = false;
      if(user){
        admin = user?.role === 'admin'
      }
      res.send({admin})
    })

    // oder stats 
    app.get('/order-stats', verifyToken, verifyAdmin, async(req, res) => {
      const result = await paymentCollection
        .aggregate([
          {
            $unwind: "$menuItemIds",
          },
          {
            $addFields: {
              menuItemIds: { $toObjectId: "$menuItemIds" },
            },
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuItemIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group : {
              _id : '$menuItems.category',
              quantity : {
                $sum : 1
              },
              revenue : { $sum : '$menuItems.price'}
            }
          },
          {
            $project : {
              _id : 0,
              category : '$_id',
              quantity : '$quantity',
              revenue : '$revenue',
            }
          },
        ])
        .toArray();

      res.send(result)
    })

    // admin stats
    app.get('/admin-stats',verifyToken,verifyAdmin, async(req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      const result = await paymentCollection.aggregate([
        {
          $group : {
            _id : null,
            totalReveune : {
             $sum : '$price'
            }
          } 
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalReveune : 0;

      res.send({users, menuItems, orders, revenue})
    })

    // user related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existUser = await usersCollection.findOne(query);
      if (existUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.delete('/users/:id',verifyToken,verifyAdmin,async(req, res)=>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await usersCollection.deleteOne(query);
      res.send(result)
    })

    app.patch("/users/admin/:id",verifyToken,verifyAdmin,async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // menu related api
    app.get('/menu',async(req, res) => {
        const result = await menuCollection.find().toArray();
        res.send(result)
    })

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      console.log(result)
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await menuCollection.insertOne(data);
      res.send(result);
    });

    app.patch('/menu/:id', async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const updatedDoc = {
        $set : {
          name : item.name,
          price : item.price,
          recipe : item.recipe,
          category : item.category,
          image : item.image,
        }
      };
      const result = await menuCollection.updateOne(query,updatedDoc)
      res.send(result)
    })

    app.delete('/menu/:id', verifyToken,verifyAdmin,async(req, res) => {
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await menuCollection.deleteOne(query);
      res.send(result)
    })

    // review related api
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // cart replated api
    app.get('/carts', async( req, res)=>{
      const email = req.query.email;
      const query = {email : email}
      const result = await cartCollection.find(query).toArray();
      res.send(result)
    })

    app.post('/carts', async(req, res)=>{
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/cart/:id', async(req, res) =>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    })

    // payment intent

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get('/payments/:email', verifyToken, async (req, res) =>{
      const email = req.params.email;
      const query = { email: email };
      if(email !== req.decoded.email){
        return req.status(403).send({message : 'forbidden access'})
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })

    app.post('/payments', async( req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      // console.log('payment info: ',payment)
      const query = {_id : {
        $in :payment.cartIds.map(id => new ObjectId(id))
      }}
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({paymentResult, deleteResult})
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/',(req, res) => {
    res.send("Bistro Boss is running...")
})

app.listen(port,()=>{
    console.log(`my port is running on ${port}`)
})