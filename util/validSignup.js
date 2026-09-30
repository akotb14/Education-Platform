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
    },
  },
}
module.exports =ajv.compile(schema);