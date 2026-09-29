const Ajv = require('ajv').default;
const ajv =new Ajv({allErrors:true, $data :true , strict:false})
require("ajv-formats")(ajv)
require('ajv-errors')(ajv);
const schema ={
    type:"object",
    required: ["fullName", "cardNumber", "password","confirmPassword"],
  allOf: [
    {
      properties: {
        fullName:{
            minLength:1,
            type:"string",
        },
        cardNumber:{
            type:"string",
            pattern: "^[0-9]*$"            
          },
        phoneNumber:{
            type:"string",
            
           pattern: "^[0-9]*$"            
        },parentPhone:{
            type:"string",
            
            pattern: "^[0-9]*$"                        
        },government:{
        type:"string",
      }
        ,grade:{
            type:"string",
            enum:['1st','2nd','3rd'],
        },
        password:{
            type:"string",
            /* There was no minimum at all, so "1" was a valid password for a
               student account — and there is no self-service password change in
               this application, so whatever an admin types on the create form is
               that account's password indefinitely.

               The message is attached to the subschema rather than to the
               root-level errorMessage.properties block below: `password` is
               declared inside allOf[0].properties, and ajv-errors matches a
               root-level properties entry against the root schema's own
               properties, not against one nested under allOf. A message put
               there would silently never appear. */
            minLength: 8,
            errorMessage: "كلمة السر يجب أن تكون 8 أحرف على الأقل.",
        }
        ,confirmPassword:{
          const:{$data:'1/password'}
        }
      },
    },
  ],
  errorMessage: {
    properties: {
      fullName: "fullname is required",
      //cardNumber: "cardNumber is required and minlength is 10",
    // phoneNumber: "phoneNumber is required and minlength is 10",
      //parentPhone: "parentNumber is required and minlength is 10",
    //  grade: "grade is require ",
      //password: "password is required and minLength is 8",
      //confirmPassword:"password is not match ",
    },
  },
}
module.exports =ajv.compile(schema);